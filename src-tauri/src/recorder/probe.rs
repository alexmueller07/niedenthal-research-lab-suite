// Post-recording verification.
//
// The claim this app makes is that frame N of the output sits at exactly N/fps
// seconds. A claim like that is worth nothing unless it is checked, so every
// finished file is measured rather than assumed: the container's declared frame
// rates must agree, the frame count must match the duration, every presentation
// timestamp must land on the grid, and the audio track must exist and carry
// signal.
//
// A file that fails any of these is marked suspect in the UI and in the
// database. Nothing here silently "repairs" anything — a recording that went
// wrong is a fact about the session, and the researcher is the one who decides
// what it means.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::recorder::ffmpeg::run_tool;

/// Presentation timestamps are stored as integers over a container timescale,
/// so exact equality is the wrong test. A frame more than this far from its
/// nominal slot is a real timing defect, not rounding.
const PTS_TOLERANCE_MS: f64 = 1.5;

/// Mean volume below this is silence for practical purposes — a muted input or
/// the wrong device, not a quiet room.
const SILENCE_THRESHOLD_DBFS: f64 = -60.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub ok: bool,
    /// The container's two frame-rate fields agree with each other and with the
    /// rate we asked for.
    pub cfr: bool,
    /// Every gap between consecutive timestamps is 1/fps.
    pub pts_uniform: bool,
    pub audio_present: bool,
    /// None when there is no audio track to judge.
    pub audio_silent: Option<bool>,

    pub r_frame_rate: String,
    pub avg_frame_rate: String,
    pub nominal_fps: u32,
    pub frame_count: u64,
    pub expected_frame_count: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub audio_codec: Option<String>,
    pub size_bytes: u64,
    pub max_pts_deviation_ms: f64,
    pub mean_volume_dbfs: Option<f64>,
    /// Human-readable statements of what is wrong, in the order found.
    pub problems: Vec<String>,
}

/// FFmpeg reports frame rates as rationals ("30/1", "30000/1001").
pub fn parse_rational(text: &str) -> Option<f64> {
    let text = text.trim();
    match text.split_once('/') {
        Some((n, d)) => {
            let n: f64 = n.trim().parse().ok()?;
            let d: f64 = d.trim().parse().ok()?;
            (d != 0.0).then_some(n / d)
        }
        None => text.parse().ok(),
    }
}

/// Checks that timestamps sit on the 1/fps grid.
///
/// Returns whether every gap is within tolerance, and the largest deviation
/// found, so the UI can show how far off it was rather than only that it was.
pub fn pts_uniformity(times: &mut [f64], fps: f64) -> (bool, f64) {
    if times.len() < 2 || fps <= 0.0 {
        return (times.len() < 2, 0.0);
    }
    // Packet order is not presentation order once B-frames are in play; the
    // grid is a property of the set of timestamps, not of their storage order.
    times.sort_by(f64::total_cmp);

    let expected = 1.0 / fps;
    let mut worst = 0.0f64;
    for pair in times.windows(2) {
        let deviation = ((pair[1] - pair[0]) - expected).abs() * 1000.0;
        if deviation > worst {
            worst = deviation;
        }
    }
    (worst <= PTS_TOLERANCE_MS, worst)
}

/// Pulls the mean volume out of FFmpeg's `volumedetect` output.
pub fn parse_mean_volume(stderr: &str) -> Option<f64> {
    for line in stderr.lines() {
        if let Some(at) = line.find("mean_volume:") {
            let rest = &line[at + "mean_volume:".len()..];
            let token = rest.split_whitespace().next()?;
            return token.parse::<f64>().ok();
        }
    }
    None
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    nb_frames: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    size: Option<String>,
}

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

/// Verifies a finished recording against the frame rate it was supposed to have.
pub async fn verify(app: &AppHandle, path: &str, nominal_fps: u32) -> Result<Verification, String> {
    let (stdout, stderr) = run_tool(
        app,
        "ffprobe",
        vec![
            "-v".into(),
            "error".into(),
            "-show_entries".into(),
            "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames".into(),
            "-show_entries".into(),
            "format=duration,size".into(),
            "-of".into(),
            "json".into(),
            path.into(),
        ],
    )
    .await?;

    let parsed: ProbeOutput = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not read ffprobe output ({e}); ffprobe said: {stderr}"))?;

    let video = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| "The file has no video stream at all.".to_string())?;
    let audio = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));

    let r_frame_rate = video.r_frame_rate.clone().unwrap_or_default();
    let avg_frame_rate = video.avg_frame_rate.clone().unwrap_or_default();
    let duration_seconds = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    let size_bytes = parsed
        .format
        .as_ref()
        .and_then(|f| f.size.as_ref())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let mut problems: Vec<String> = Vec::new();
    let target = f64::from(nominal_fps);
    let r_value = parse_rational(&r_frame_rate);
    let avg_value = parse_rational(&avg_frame_rate);

    // Constant frame rate means these two agree. When capture drifts, avg
    // wanders away from r while r keeps claiming the nominal rate.
    let rates_agree = matches!((r_value, avg_value), (Some(r), Some(a)) if (r - a).abs() < 0.01);
    let rate_is_nominal = matches!(r_value, Some(r) if (r - target).abs() < 0.01);
    if !rates_agree {
        problems.push(format!(
            "Declared frame rates disagree: r_frame_rate {r_frame_rate}, avg_frame_rate {avg_frame_rate}. The file is not constant frame rate."
        ));
    }
    if !rate_is_nominal {
        problems.push(format!(
            "Recorded at {r_frame_rate}, but {nominal_fps} fps was requested."
        ));
    }

    let frame_count = video
        .nb_frames
        .as_ref()
        .and_then(|n| n.parse::<u64>().ok())
        .unwrap_or(0);
    let expected_frame_count = (duration_seconds * target).round() as u64;
    // One frame of slack: the last frame's duration is not part of the reported
    // duration in every muxer.
    if frame_count > 0 && expected_frame_count > 0 {
        let diff = frame_count.abs_diff(expected_frame_count);
        // Expected count is duration x nominal fps, and the container's
        // duration is itself rounded, so a long take lands a few frames either
        // side without anything being wrong: a real 104 s recording came in 4
        // frames under and was reported as a problem, which teaches RAs to
        // ignore the verdict. Scale the tolerance with length (a tenth of a
        // second's worth) and keep a floor for short takes. A genuine mismatch
        // — the encoder falling behind, a truncated file — misses by orders of
        // magnitude more than this.
        let tolerance = (expected_frame_count / 1000).max(2);
        if diff > tolerance {
            problems.push(format!(
                "Frame count {frame_count} does not match {duration_seconds:.3} s at {nominal_fps} fps (expected about {expected_frame_count})."
            ));
        }
    }

    // Every timestamp, checked against the grid. Packets rather than decoded
    // frames: same timing information, a fraction of the work.
    let (packets_stdout, _) = run_tool(
        app,
        "ffprobe",
        vec![
            "-v".into(),
            "error".into(),
            "-select_streams".into(),
            "v:0".into(),
            "-show_entries".into(),
            "packet=pts_time".into(),
            "-of".into(),
            "csv=p=0".into(),
            path.into(),
        ],
    )
    .await?;
    let mut times: Vec<f64> = packets_stdout
        .lines()
        .filter_map(|l| l.trim().trim_end_matches(',').parse::<f64>().ok())
        .collect();
    let (pts_uniform, max_pts_deviation_ms) = pts_uniformity(&mut times, target);
    if !pts_uniform {
        problems.push(format!(
            "Frame timing is uneven — the worst gap is {max_pts_deviation_ms:.2} ms away from the expected {:.2} ms.",
            1000.0 / target
        ));
    }

    // Audio: present, and carrying signal. A silent track is the most common
    // way a session is quietly lost, and it looks identical to a good one in
    // every property except this.
    let audio_present = audio.is_some();
    let mut audio_silent = None;
    let mut mean_volume_dbfs = None;
    if audio_present {
        let (_, vol_stderr) = run_tool(
            app,
            "ffmpeg",
            vec![
                "-hide_banner".into(),
                "-i".into(),
                path.into(),
                "-map".into(),
                "0:a:0".into(),
                "-af".into(),
                "volumedetect".into(),
                "-f".into(),
                "null".into(),
                "-".into(),
            ],
        )
        .await?;
        mean_volume_dbfs = parse_mean_volume(&vol_stderr);
        if let Some(mean) = mean_volume_dbfs {
            let silent = mean < SILENCE_THRESHOLD_DBFS;
            audio_silent = Some(silent);
            if silent {
                problems.push(format!(
                    "The audio track is effectively silent ({mean:.1} dBFS). Check that the right microphone was selected and not muted."
                ));
            }
        }
    } else {
        problems.push("There is no audio track in this recording.".into());
    }

    Ok(Verification {
        ok: problems.is_empty(),
        cfr: rates_agree && rate_is_nominal,
        pts_uniform,
        audio_present,
        audio_silent,
        r_frame_rate,
        avg_frame_rate,
        nominal_fps,
        frame_count,
        expected_frame_count,
        duration_seconds,
        width: video.width.unwrap_or(0),
        height: video.height.unwrap_or(0),
        video_codec: video.codec_name.clone().unwrap_or_default(),
        audio_codec: audio.and_then(|a| a.codec_name.clone()),
        size_bytes,
        max_pts_deviation_ms,
        mean_volume_dbfs,
        problems,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frame_rate_rationals() {
        assert_eq!(parse_rational("30/1"), Some(30.0));
        assert_eq!(parse_rational("60/1"), Some(60.0));
        assert!((parse_rational("30000/1001").unwrap() - 29.97).abs() < 0.001);
        assert_eq!(parse_rational("25"), Some(25.0));
        assert_eq!(parse_rational("0/0"), None);
        assert_eq!(parse_rational("nonsense"), None);
    }

    #[test]
    fn perfect_grid_passes() {
        let mut times: Vec<f64> = (0..300).map(|i| f64::from(i) / 30.0).collect();
        let (uniform, worst) = pts_uniformity(&mut times, 30.0);
        assert!(uniform);
        assert!(worst < 0.001);
    }

    #[test]
    fn a_single_late_frame_is_caught() {
        let mut times: Vec<f64> = (0..300).map(|i| f64::from(i) / 30.0).collect();
        times[150] += 0.010; // 10 ms late — invisible to a viewer, fatal to alignment
        let (uniform, worst) = pts_uniformity(&mut times, 30.0);
        assert!(!uniform);
        assert!(worst > 9.0);
    }

    #[test]
    fn b_frame_packet_order_does_not_look_like_a_defect() {
        // Packets arrive out of presentation order; the grid is still intact.
        let mut times = vec![0.0, 2.0 / 30.0, 1.0 / 30.0, 4.0 / 30.0, 3.0 / 30.0];
        let (uniform, _) = pts_uniformity(&mut times, 30.0);
        assert!(uniform);
    }

    #[test]
    fn rounding_within_a_container_timescale_is_not_a_defect() {
        let mut times: Vec<f64> = (0..100).map(|i| (f64::from(i) / 30.0 * 90000.0).round() / 90000.0).collect();
        let (uniform, worst) = pts_uniformity(&mut times, 30.0);
        assert!(uniform, "worst was {worst} ms");
    }

    #[test]
    fn too_few_timestamps_to_judge_is_not_a_failure() {
        let (uniform, worst) = pts_uniformity(&mut [1.0], 30.0);
        assert!(uniform);
        assert_eq!(worst, 0.0);
    }

    #[test]
    fn reads_mean_volume() {
        let stderr = "[Parsed_volumedetect_0 @ 0x5] n_samples: 28800000\n\
                      [Parsed_volumedetect_0 @ 0x5] mean_volume: -23.4 dB\n\
                      [Parsed_volumedetect_0 @ 0x5] max_volume: -3.1 dB";
        assert_eq!(parse_mean_volume(stderr), Some(-23.4));
    }

    #[test]
    fn recognises_a_dead_microphone() {
        let stderr = "[Parsed_volumedetect_0 @ 0x5] mean_volume: -91.0 dB";
        let mean = parse_mean_volume(stderr).unwrap();
        assert!(mean < SILENCE_THRESHOLD_DBFS);
    }

    #[test]
    fn a_quiet_room_is_not_reported_as_silence() {
        let stderr = "[Parsed_volumedetect_0 @ 0x5] mean_volume: -44.2 dB";
        let mean = parse_mean_volume(stderr).unwrap();
        assert!(mean > SILENCE_THRESHOLD_DBFS);
    }

    #[test]
    fn missing_volume_output_is_none_not_zero() {
        assert_eq!(parse_mean_volume("Stream mapping:"), None);
    }
}
