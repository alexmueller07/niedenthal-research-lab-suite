// The sidecar manifest — the receipt that turns a video file into a measurement.
//
// A .mp4 on its own cannot answer the questions a lab actually needs answered
// later: which camera produced it, at what negotiated mode, with which encoder
// build, did it drop frames, did anyone verify it, and were the other rooms
// configured the same way. Six months on, none of that is recoverable from the
// file. So it is written next to it, as JSON, at the moment it is known.
//
// Nothing in here identifies a participant. Session and dyad codes only, per
// the lab's CLAUDE.md rule about identifiers in filenames and artefacts.

use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::ffmpeg::{RateControl, RecordSettings};
use crate::probe::Verification;
use crate::recorder::ProgressSnapshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub name: String,
    pub fingerprint: String,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRecord {
    pub width: u32,
    pub height: u32,
    pub requested_fps: u32,
    pub input_format: Option<String>,
    pub encoder: String,
    pub encoder_preset: String,
    pub rate_control: RateControl,
    pub gop_seconds: f64,
    pub audio_codec: Option<String>,
    pub audio_bitrate_kbps: Option<u32>,
    pub audio_sample_rate: Option<u32>,
    pub audio_channels: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingManifest {
    pub recorder_version: String,
    pub ffmpeg_version: String,
    pub machine: String,
    pub os: String,

    /// Identifies the encoding settings, not the machine. Two recordings with
    /// the same hash were produced the same way; that is the whole
    /// cross-machine parity check, reduced to a string comparison.
    pub profile_hash: String,
    pub profile_name: Option<String>,

    pub device: DeviceRecord,
    pub capture: CaptureRecord,

    pub file: String,
    pub started_at: String,
    pub ended_at: String,
    pub wall_duration_ms: u64,

    pub frames_written: u64,
    pub frames_dropped: u64,
    pub frames_duplicated: u64,
    pub achieved_fps: f64,
    /// FFmpeg's encode speed multiplier at the end of the take. Under 1.0 means
    /// the machine could not keep up, which is the cause behind most drops.
    pub encoder_speed: f64,

    pub size_bytes: u64,
    pub sha256: String,
    pub verification: Verification,

    pub discreet_mode: bool,
    /// Set when the operator supplied one. Never a name or an email.
    pub session_code: Option<String>,
    pub notes: Option<String>,
}

/// Hash of the settings that determine what the encoded file looks like.
///
/// Deliberately excludes device tokens and paths: the same profile applied to a
/// different camera on a different machine must still hash identically, because
/// the question being asked is "were these configured the same way?".
pub fn profile_hash(settings: &RecordSettings) -> String {
    let canonical = serde_json::json!({
        "width": settings.width,
        "height": settings.height,
        "fps": settings.fps,
        "inputFormat": settings.input_format,
        "encoder": settings.encoder,
        "encoderPreset": settings.encoder_preset,
        "rateControl": settings.rate_control,
        "gopSeconds": settings.gop_seconds,
        "audio": settings.audio.as_ref().map(|a| serde_json::json!({
            "bitrateKbps": a.bitrate_kbps,
            "sampleRate": a.sample_rate,
            "channels": a.channels,
        })),
    });
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string().as_bytes());
    format!("{:x}", hasher.finalize())[..12].to_string()
}

/// SHA-256 of a file, read in chunks so a multi-gigabyte recording does not
/// have to fit in memory. This is what makes the Research Drive copy verifiable
/// rather than merely attempted.
pub fn file_sha256(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("could not open {} for checksumming: {e}", path.display()))?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Frames actually written divided by wall time. Diverging from the requested
/// rate means the camera or the encoder did not hold up, even when the file
/// itself is constant frame rate — because CFR is achieved by duplicating.
pub fn achieved_fps(progress: &ProgressSnapshot, wall_duration_ms: u64) -> f64 {
    if wall_duration_ms == 0 {
        return 0.0;
    }
    progress.frames as f64 / (wall_duration_ms as f64 / 1000.0)
}

/// Plain-language summary for the finish screen. Reports what happened rather
/// than reassuring: a recording that dropped frames says so, in frames and in
/// seconds of lost material.
pub fn quality_summary(progress: &ProgressSnapshot, fps: u32, verification: &Verification) -> String {
    let mut parts: Vec<String> = Vec::new();

    if progress.dropped_frames > 0 {
        let seconds = progress.dropped_frames as f64 / f64::from(fps.max(1));
        parts.push(format!(
            "{} frames were dropped ({seconds:.1} s of material never reached the file).",
            progress.dropped_frames
        ));
    }
    // Duplicates are how constant frame rate is maintained when the camera
    // under-delivers, so a handful is normal and a lot is a symptom.
    if progress.duplicated_frames > f64::from(fps) as u64 {
        let seconds = progress.duplicated_frames as f64 / f64::from(fps.max(1));
        parts.push(format!(
            "{} frames were duplicated to hold constant frame rate ({seconds:.1} s of repeated material) — the camera was not keeping up.",
            progress.duplicated_frames
        ));
    }
    if progress.speed > 0.0 && progress.speed < 0.98 {
        parts.push(format!(
            "The encoder ran at {:.2}x real time; this machine is at its limit for these settings.",
            progress.speed
        ));
    }
    parts.extend(verification.problems.iter().cloned());

    if parts.is_empty() {
        format!(
            "Verified: {} frames at a constant {} fps, timing exact, audio present.",
            verification.frame_count, verification.nominal_fps
        )
    } else {
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::{AudioSettings, ContainerStrategy};

    fn settings() -> RecordSettings {
        RecordSettings {
            video_device_token: "CAM-A".into(),
            audio: Some(AudioSettings {
                device_token: "MIC-A".into(),
                bitrate_kbps: 128,
                sample_rate: 48000,
                channels: 2,
            }),
            width: 1920,
            height: 1080,
            fps: 30,
            input_format: Some("mjpeg".into()),
            input_is_compressed: true,
            encoder: "libx264".into(),
            encoder_preset: "veryfast".into(),
            rate_control: RateControl::Cbr { kbps: 12000 },
            gop_seconds: 2.0,
            container: ContainerStrategy::CrashSafeMkv,
        }
    }

    fn verification(problems: Vec<String>) -> Verification {
        Verification {
            ok: problems.is_empty(),
            cfr: true,
            pts_uniform: true,
            audio_present: true,
            audio_silent: Some(false),
            r_frame_rate: "30/1".into(),
            avg_frame_rate: "30/1".into(),
            nominal_fps: 30,
            frame_count: 18000,
            expected_frame_count: 18000,
            duration_seconds: 600.0,
            width: 1920,
            height: 1080,
            video_codec: "h264".into(),
            audio_codec: Some("aac".into()),
            size_bytes: 909_600_000,
            max_pts_deviation_ms: 0.01,
            mean_volume_dbfs: Some(-24.0),
            problems,
        }
    }

    #[test]
    fn same_settings_on_different_machines_hash_identically() {
        let mut other = settings();
        other.video_device_token = "a completely different camera".into();
        other.audio.as_mut().unwrap().device_token = "another mic".into();
        assert_eq!(profile_hash(&settings()), profile_hash(&other));
    }

    #[test]
    fn a_changed_bitrate_changes_the_hash() {
        let mut other = settings();
        other.rate_control = RateControl::Cbr { kbps: 8000 };
        assert_ne!(profile_hash(&settings()), profile_hash(&other));
    }

    #[test]
    fn a_changed_frame_rate_changes_the_hash() {
        let mut other = settings();
        other.fps = 60;
        assert_ne!(profile_hash(&settings()), profile_hash(&other));
    }

    #[test]
    fn turning_audio_off_changes_the_hash() {
        let mut other = settings();
        other.audio = None;
        assert_ne!(profile_hash(&settings()), profile_hash(&other));
    }

    #[test]
    fn hash_is_short_enough_to_read_aloud() {
        assert_eq!(profile_hash(&settings()).len(), 12);
    }

    #[test]
    fn achieved_rate_is_frames_over_wall_time() {
        let p = ProgressSnapshot { frames: 18000, ..Default::default() };
        assert!((achieved_fps(&p, 600_000) - 30.0).abs() < 0.001);
        assert_eq!(achieved_fps(&p, 0), 0.0);
    }

    #[test]
    fn a_clean_take_says_so_without_hedging() {
        let p = ProgressSnapshot { frames: 18000, speed: 1.0, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec![]));
        assert!(s.starts_with("Verified:"));
    }

    #[test]
    fn dropped_frames_are_reported_in_seconds_lost() {
        let p = ProgressSnapshot { frames: 17_550, dropped_frames: 450, speed: 1.0, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec![]));
        assert!(s.contains("450 frames were dropped"));
        assert!(s.contains("15.0 s"));
    }

    #[test]
    fn a_few_duplicates_are_normal_and_stay_quiet() {
        // CFR is maintained by duplicating; a handful is not worth alarming over.
        let p = ProgressSnapshot { frames: 18000, duplicated_frames: 3, speed: 1.0, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec![]));
        assert!(s.starts_with("Verified:"));
    }

    #[test]
    fn heavy_duplication_is_surfaced_as_a_camera_problem() {
        let p = ProgressSnapshot { frames: 18000, duplicated_frames: 900, speed: 1.0, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec![]));
        assert!(s.contains("duplicated"));
        assert!(s.contains("not keeping up"));
    }

    #[test]
    fn a_struggling_encoder_is_named() {
        let p = ProgressSnapshot { frames: 18000, speed: 0.82, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec![]));
        assert!(s.contains("0.82x real time"));
    }

    #[test]
    fn verification_problems_are_carried_through_verbatim() {
        let p = ProgressSnapshot { frames: 18000, speed: 1.0, ..Default::default() };
        let s = quality_summary(&p, 30, &verification(vec!["The audio track is effectively silent.".into()]));
        assert!(s.contains("effectively silent"));
    }
}
