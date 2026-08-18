// FFmpeg sidecar plumbing and — more importantly — the argument builder.
//
// Everything in the bottom half of this file is a pure function over settings,
// because the argument list IS the scientific instrument. `-fps_mode cfr`
// missing, or an input pixel format the camera can only deliver at 5 fps, does
// not crash anything: it silently produces a file that looks fine and scores
// wrong. So the args are built by testable code with the reasoning written
// down, not assembled ad hoc at the call site.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Choosing an encoder that can keep up
// ---------------------------------------------------------------------------
//
// Software x264 cannot hold 1080p30 in real time on an ordinary laptop, and
// the failure mode is silent and severe: FFmpeg consumes the camera slower
// than the camera produces, and the finished file is *shorter than the
// conversation* — 158 s of session became 52 s of video on the first real
// test of this app (2026-08-17), with every frame time therefore wrong. For
// a study that aligns a 100 ms slider trace against video time, that is not
// a performance issue, it is corrupted data.
//
// Every machine made in the last decade has a hardware H.264 encoder that
// does this at 1.0x while barely warming up (measured on the test laptop:
// x264 veryfast 0.34x, Intel QSV 0.99x). So the encoder is chosen by asking
// the machine what it actually has, once per run, and x264 remains the
// fallback for anything exotic.
//
// The tradeoff, stated plainly because it changes a lab guarantee: two
// machines with different GPUs no longer encode byte-identically. The
// pinned FFmpeg build still guarantees identical *timing* semantics, the
// resolution/frame rate/bitrate are unchanged, and the encoder that actually
// ran is recorded in every recording's manifest — but a profile hash from an
// Intel machine will differ from an NVIDIA one. Randy needs to know that
// before the lab standardises.

/// Candidates in preference order. All are hardware except the last.
const ENCODER_CANDIDATES: [&str; 4] = ["h264_qsv", "h264_nvenc", "h264_amf", "libx264"];

static DETECTED_ENCODER: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderFamily {
    X264,
    Qsv,
    Nvenc,
    Amf,
}

pub fn encoder_family(name: &str) -> EncoderFamily {
    match name {
        "h264_qsv" => EncoderFamily::Qsv,
        "h264_nvenc" => EncoderFamily::Nvenc,
        "h264_amf" => EncoderFamily::Amf,
        _ => EncoderFamily::X264,
    }
}

/// The best encoder this machine can actually run, probed once per process.
///
/// "Listed in -encoders" is not the same as "works": a driver can be absent
/// or refuse a session. Each candidate therefore has to encode a handful of
/// synthetic frames to disk-nowhere before it is trusted.
pub async fn best_encoder(app: &AppHandle) -> String {
    if let Ok(guard) = DETECTED_ENCODER.lock() {
        if let Some(found) = guard.as_ref() {
            return found.clone();
        }
    }

    let mut chosen = "libx264".to_string();
    for candidate in ENCODER_CANDIDATES {
        if candidate == "libx264" {
            break; // the fallback needs no proving
        }
        let args: Vec<String> = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "nullsrc=s=640x480:r=30:d=0.3",
            "-c:v",
            candidate,
            "-f",
            "null",
            "-",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        if run_tool(app, "ffmpeg", args).await.is_ok() {
            chosen = candidate.to_string();
            break;
        }
    }

    if let Ok(mut guard) = DETECTED_ENCODER.lock() {
        *guard = Some(chosen.clone());
    }
    chosen
}

/// Encoder selection plus rate control, which have to be decided together —
/// the hardware encoders spell their speed knob differently and none of them
/// take x264's `-crf`.
fn encode_args(a: &mut Vec<String>, settings: &RecordSettings) {
    let push = |a: &mut Vec<String>, s: &str| a.push(s.to_string());
    let family = encoder_family(&settings.encoder);

    push(a, "-c:v");
    a.push(settings.encoder.clone());

    match family {
        EncoderFamily::X264 => {
            push(a, "-preset");
            a.push(settings.encoder_preset.clone());
        }
        EncoderFamily::Qsv => {
            // QSV understands x264's preset vocabulary, but the preset the
            // profiles carry ("veryfast") is chosen for software, where speed
            // is scarce. On the iGPU it is not: "slower" costs almost nothing
            // here and spends the silicon on picture instead.
            push(a, "-preset");
            push(a, "slower");
        }
        EncoderFamily::Nvenc => {
            // p1 (fastest) .. p7. p4 is the balanced point and still an order
            // of magnitude faster than software here.
            push(a, "-preset");
            push(a, "p4");
            push(a, "-tune");
            push(a, "ll"); // low latency: this is live capture, not a transcode
        }
        EncoderFamily::Amf => {
            push(a, "-quality");
            push(a, "balanced");
        }
    }

    // Bitrate. The hardware encoders have no CRF equivalent worth trusting
    // across vendors, so a CRF profile is expressed to them as a bitrate
    // derived from the frame size — the same picture budget, stated the way
    // each encoder understands.
    // Hardware encoders are markedly less efficient per bit than x264 — the
    // same 4 Mbps that looks clean from software looks blocky from an iGPU,
    // which is exactly what the first hardware-encoded takes looked like
    // (2026-08-17). The profiles state a quality intent, not a byte budget, so
    // honour the intent: give the hardware path the bitrate it needs to match.
    // Sizes on the quality cards are software figures and stay honest for
    // software; a machine on hardware writes larger files for the same
    // picture, which is the right trade for study video.
    let bitrate_scale = if family == EncoderFamily::X264 { 1.0 } else { 1.7 };

    let kbps = match settings.rate_control {
        RateControl::Cbr { kbps } => (f64::from(kbps) * bitrate_scale) as u32,
        RateControl::Crf { crf } => {
            let pixels = f64::from(settings.width * settings.height);
            let base = pixels * f64::from(settings.fps) / 1000.0 * 0.10;
            // Higher CRF means smaller; 23 is the neutral point.
            let scale = 2f64.powf((23.0 - f64::from(crf)) / 6.0);
            ((base * scale * bitrate_scale) as u32).clamp(1500, 60000)
        }
    };

    if family == EncoderFamily::X264 {
        if let RateControl::Crf { crf } = settings.rate_control {
            push(a, "-crf");
            a.push(crf.to_string());
        } else {
            // maxrate == bitrate with a 2x buffer is what actually pins the
            // size; -b:v alone is only an average target and can overshoot.
            push(a, "-b:v");
            a.push(format!("{kbps}k"));
            push(a, "-maxrate");
            a.push(format!("{kbps}k"));
            push(a, "-bufsize");
            a.push(format!("{}k", kbps * 2));
        }
    } else {
        push(a, "-b:v");
        a.push(format!("{kbps}k"));
        push(a, "-maxrate");
        a.push(format!("{kbps}k"));
        push(a, "-bufsize");
        a.push(format!("{}k", kbps * 2));
    }

    // 4:2:0 because anything else is unplayable in half the tools a lab uses,
    // including the PPS app's own <video> element. QSV takes the camera's own
    // nv12 straight through (same 4:2:0 data, one less conversion per frame);
    // the others want it spelled yuv420p.
    push(a, "-pix_fmt");
    if family == EncoderFamily::Qsv {
        push(a, "nv12");
    } else {
        push(a, "yuv420p");
    }
}

/// Which host API FFmpeg captures through. Chosen by target OS, not by the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureBackend {
    /// Windows. Any USB UVC webcam appears here; many laptop-internal MIPI
    /// cameras deliberately do not (see devices::os_camera_gap).
    DirectShow,
    /// macOS.
    AvFoundation,
}

impl CaptureBackend {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            CaptureBackend::DirectShow
        } else {
            CaptureBackend::AvFoundation
        }
    }

    pub fn format_flag(self) -> &'static str {
        match self {
            CaptureBackend::DirectShow => "dshow",
            CaptureBackend::AvFoundation => "avfoundation",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum RateControl {
    /// Constant bitrate. The default, because it makes the size estimate
    /// arithmetic rather than a guess — which is what the novice-facing
    /// "how much space will this take?" readout depends on.
    Cbr { kbps: u32 },
    /// Constant quality. Better bits-per-byte, unpredictable file size.
    Crf { crf: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContainerStrategy {
    /// Capture to Matroska, remux losslessly to MP4 on stop. An MP4 killed
    /// mid-write has no moov atom and is effectively unrecoverable; MKV
    /// survives — verified by force-killing a capture and recovering a clean
    /// 30/1 file from it. Costs ~2x space transiently, and Matroska's 1 ms
    /// timecode scale leaves frames up to 0.667 ms off the ideal grid.
    ///
    /// The default, because 0.667 ms is under 1% of one 100 ms slider sample
    /// while a lost conversation cannot be recovered at all.
    CrashSafeMkv,
    /// Write the MP4 directly. Timestamps are exact to 0.000667 ms, but a crash
    /// mid-session loses the take completely. Worth choosing only when
    /// sub-millisecond timing matters more than surviving a crash.
    DirectMp4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    /// The token handed to FFmpeg for this session. Resolved from a stable
    /// fingerprint at record time, never stored across runs.
    pub device_token: String,
    pub bitrate_kbps: u32,
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSettings {
    pub video_device_token: String,
    /// None means video-only. A recording with no audio is a legitimate choice
    /// but never an accident: the UI makes you turn audio off explicitly.
    pub audio: Option<AudioSettings>,

    pub width: u32,
    pub height: u32,
    /// Integer frame rates only, on purpose. Every webcam this app targets
    /// advertises integer rates; admitting 29.97 would mean carrying a rational
    /// timebase through the whole app to serve hardware we do not capture from.
    pub fps: u32,

    /// The input codec/pixel format picked from the camera's own advertised
    /// mode list — `mjpeg`, `nv12`, `yuyv422`, ... None lets FFmpeg negotiate,
    /// which is the right behaviour when a probe was not possible (macOS).
    pub input_format: Option<String>,
    /// True when `input_format` names a compressed stream (mjpeg/h264) rather
    /// than a raw pixel format. dshow spells those with different flags.
    pub input_is_compressed: bool,

    pub encoder: String,
    pub encoder_preset: String,
    pub rate_control: RateControl,
    /// Keyframe spacing in seconds. Short GOPs make the PPS rating task's
    /// scrubbing responsive; long GOPs make seeking feel broken.
    pub gop_seconds: f64,

    pub container: ContainerStrategy,
}

impl RecordSettings {
    /// Bytes per second at the configured rate. Only meaningful for CBR — CRF
    /// size cannot be derived from settings and is measured by calibration
    /// instead.
    pub fn estimated_bytes_per_second(&self) -> Option<u64> {
        let RateControl::Cbr { kbps } = self.rate_control else {
            return None;
        };
        let audio_kbps = self.audio.as_ref().map(|a| a.bitrate_kbps).unwrap_or(0);
        Some(u64::from(kbps + audio_kbps) * 125)
    }
}

/// Where FFmpeg writes during a session.
pub struct OutputPaths {
    /// The file FFmpeg is actively writing (.mkv or .mp4 per container strategy).
    pub capture: String,
    /// Low-rate JPEG the UI polls. This doubles as proof of life: if it is
    /// updating, frames are genuinely arriving from the camera.
    pub preview: String,
}

/// Builds the input specifier for the chosen backend.
///
/// dshow takes one combined `video=X:audio=Y` input, which keeps both streams in
/// a single DirectShow graph and gives markedly better A/V sync than opening
/// them as two inputs. AVFoundation has the same property with `"vIdx:aIdx"`.
pub fn build_input_spec(
    backend: CaptureBackend,
    video_token: &str,
    audio_token: Option<&str>,
) -> String {
    match backend {
        CaptureBackend::DirectShow => match audio_token {
            Some(a) => format!("video={video_token}:audio={a}"),
            None => format!("video={video_token}"),
        },
        CaptureBackend::AvFoundation => match audio_token {
            Some(a) => format!("{video_token}:{a}"),
            None => format!("{video_token}:none"),
        },
    }
}

/// The whole record command, as an argument vector.
///
/// Ordering follows FFmpeg's grammar: globals, then per-input options followed
/// by `-i`, then per-output options followed by each output path.
pub fn build_record_args(
    backend: CaptureBackend,
    settings: &RecordSettings,
    paths: &OutputPaths,
) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let push = |a: &mut Vec<String>, s: &str| a.push(s.to_string());

    // ---- globals ----
    push(&mut a, "-hide_banner");
    push(&mut a, "-nostdin_placeholder"); // replaced below; see note
    a.pop(); // FFmpeg must keep stdin open — that is how `q` stops it cleanly.
    push(&mut a, "-y");
    // Machine-readable progress on stdout: frame=, fps=, drop_frames=,
    // dup_frames=, out_time_us=. Scraping stderr for the same numbers is
    // brittle across FFmpeg versions; this format is stable.
    push(&mut a, "-progress");
    push(&mut a, "pipe:1");
    push(&mut a, "-nostats");

    // ---- input ----
    push(&mut a, "-f");
    push(&mut a, backend.format_flag());

    if backend == CaptureBackend::DirectShow {
        // Headroom against "real-time buffer too full, frame dropped". The
        // default is ~3 MB, which a 1080p MJPEG stream overruns the moment the
        // disk or the encoder hiccups.
        push(&mut a, "-rtbufsize");
        push(&mut a, "512M");
    }

    if let Some(fmt) = &settings.input_format {
        match backend {
            // dshow distinguishes a compressed stream from a raw pixel format,
            // and rejects the wrong flag rather than falling back.
            CaptureBackend::DirectShow => {
                if settings.input_is_compressed {
                    push(&mut a, "-vcodec");
                } else {
                    push(&mut a, "-pixel_format");
                }
                a.push(fmt.clone());
            }
            CaptureBackend::AvFoundation => {
                push(&mut a, "-pixel_format");
                a.push(fmt.clone());
            }
        }
    }

    push(&mut a, "-video_size");
    a.push(format!("{}x{}", settings.width, settings.height));
    push(&mut a, "-framerate");
    a.push(settings.fps.to_string());

    if let Some(audio) = &settings.audio {
        if backend == CaptureBackend::DirectShow {
            push(&mut a, "-sample_rate");
            a.push(audio.sample_rate.to_string());
            push(&mut a, "-channels");
            a.push(audio.channels.to_string());
        }
    }

    push(&mut a, "-i");
    a.push(build_input_spec(
        backend,
        &settings.video_device_token,
        settings.audio.as_ref().map(|x| x.device_token.as_str()),
    ));

    // ---- main output ----
    push(&mut a, "-map");
    push(&mut a, "0:v:0");
    if settings.audio.is_some() {
        push(&mut a, "-map");
        push(&mut a, "0:a:0");
    }

    encode_args(&mut a, settings);

    let gop = ((settings.gop_seconds * f64::from(settings.fps)).round() as u32).max(1);
    push(&mut a, "-g");
    a.push(gop.to_string());

    // THE line this whole application exists for. FFmpeg duplicates or drops
    // frames as needed so the output holds exactly `fps` frames per second of
    // wall time, which makes frame N land at exactly N/fps seconds. Without it
    // the file is variable-rate and every downstream time alignment drifts.
    push(&mut a, "-fps_mode");
    push(&mut a, "cfr");
    push(&mut a, "-r");
    a.push(settings.fps.to_string());

    if let Some(audio) = &settings.audio {
        push(&mut a, "-c:a");
        push(&mut a, "aac");
        push(&mut a, "-b:a");
        a.push(format!("{}k", audio.bitrate_kbps));
        push(&mut a, "-ar");
        a.push(audio.sample_rate.to_string());
        push(&mut a, "-ac");
        a.push(audio.channels.to_string());
    }

    if matches!(settings.container, ContainerStrategy::DirectMp4) {
        push(&mut a, "-movflags");
        push(&mut a, "+faststart");
        push(&mut a, "-video_track_timescale");
        a.push(mp4_timescale(settings.fps).to_string());
    }

    a.push(paths.capture.clone());

    // ---- preview output ----
    // A 10 fps JPEG the webview polls. Deliberately NOT getUserMedia: on
    // Windows a DirectShow camera is usually exclusive-access, so a webview
    // holding the device would stop FFmpeg from opening it at all.
    push(&mut a, "-map");
    push(&mut a, "0:v:0");
    push(&mut a, "-vf");
    push(&mut a, "fps=10,scale=480:-2");
    push(&mut a, "-q:v");
    push(&mut a, "7");
    push(&mut a, "-update");
    push(&mut a, "1");
    push(&mut a, "-f");
    push(&mut a, "image2");
    a.push(paths.preview.clone());

    // ---- audio meter output ----
    // ebur128 prints momentary loudness to stderr continuously. That drives the
    // level meter from the real capture path, so a meter that moves is proof
    // the recorded audio is live — not merely that some other stream is.
    if settings.audio.is_some() {
        push(&mut a, "-map");
        push(&mut a, "0:a:0");
        push(&mut a, "-af");
        push(&mut a, "ebur128=peak=true");
        push(&mut a, "-f");
        push(&mut a, "null");
        push(&mut a, "-");
    }

    a
}

/// Preview-only pipeline, used on the setup screen before a take starts.
///
/// Same device, same negotiation, no file output — so if the preview works the
/// real recording will open the device too. Stopped before the real capture
/// spawns, so the two never contend for an exclusive-access camera.
pub fn build_preview_args(
    backend: CaptureBackend,
    settings: &RecordSettings,
    preview_path: &str,
) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let push = |a: &mut Vec<String>, s: &str| a.push(s.to_string());

    push(&mut a, "-hide_banner");
    push(&mut a, "-y");
    push(&mut a, "-progress");
    push(&mut a, "pipe:1");
    push(&mut a, "-nostats");
    push(&mut a, "-f");
    push(&mut a, backend.format_flag());

    if backend == CaptureBackend::DirectShow {
        push(&mut a, "-rtbufsize");
        push(&mut a, "256M");
    }
    if let Some(fmt) = &settings.input_format {
        match backend {
            CaptureBackend::DirectShow => {
                if settings.input_is_compressed {
                    push(&mut a, "-vcodec");
                } else {
                    push(&mut a, "-pixel_format");
                }
                a.push(fmt.clone());
            }
            CaptureBackend::AvFoundation => {
                push(&mut a, "-pixel_format");
                a.push(fmt.clone());
            }
        }
    }
    push(&mut a, "-video_size");
    a.push(format!("{}x{}", settings.width, settings.height));
    push(&mut a, "-framerate");
    a.push(settings.fps.to_string());
    push(&mut a, "-i");
    a.push(build_input_spec(
        backend,
        &settings.video_device_token,
        // Audio is included so the level meter works on the setup screen, which
        // is where a muted or wrong microphone actually gets caught.
        settings.audio.as_ref().map(|x| x.device_token.as_str()),
    ));

    push(&mut a, "-map");
    push(&mut a, "0:v:0");
    push(&mut a, "-vf");
    push(&mut a, "fps=10,scale=480:-2");
    push(&mut a, "-q:v");
    push(&mut a, "7");
    push(&mut a, "-update");
    push(&mut a, "1");
    push(&mut a, "-f");
    push(&mut a, "image2");
    a.push(preview_path.to_string());

    if settings.audio.is_some() {
        push(&mut a, "-map");
        push(&mut a, "0:a:0");
        push(&mut a, "-af");
        push(&mut a, "ebur128=peak=true");
        push(&mut a, "-f");
        push(&mut a, "null");
        push(&mut a, "-");
    }

    a
}

/// A timebase in which one frame is exactly a whole number of ticks.
///
/// MP4 stores timestamps as integers over a timescale, so the timescale bounds
/// how exactly "frame N is at N/fps seconds" can be expressed. Measured on real
/// 30 fps captures from this app:
///
///   direct MP4, timescale 30000  ->  0.000667 ms worst deviation
///   direct MP4, muxer default    ->  0.667 ms
///
/// It does *not* rescue the crash-safe path. Remuxing from Matroska copies
/// timestamps that Matroska already rounded to its 1 ms timecode scale, so that
/// route measures 0.667 ms whatever timescale the MP4 declares. Setting it is
/// still right — it costs nothing and it is what makes DirectMp4 exact.
pub fn mp4_timescale(fps: u32) -> u32 {
    fps.max(1) * 1000
}

/// Lossless container swap. No re-encode, so this cannot degrade the video and
/// cannot disturb the frame timing established during capture.
pub fn build_remux_args(input: &str, output: &str, fps: u32) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input.into(),
        "-c".into(),
        "copy".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-video_track_timescale".into(),
        mp4_timescale(fps).to_string(),
        output.into(),
    ]
}

/// A fixed-length rehearsal of the real thing.
///
/// Deliberately built from `build_record_args` rather than from the preview
/// pipeline: a preflight that exercises a different code path than the take is
/// worth very little. This opens the same device in the same mode, runs the
/// same encoder at the same bitrate, and writes the same container — just for
/// five seconds, to a file that gets thrown away.
///
/// `-t` sits on the *input* side. As an output option it ends only the output
/// it precedes, and FFmpeg keeps running to serve the others — with the
/// `-update 1` preview attached, that means it never exits at all. Learned by
/// watching a test capture run for three minutes past its stop time.
pub fn build_preflight_args(
    backend: CaptureBackend,
    settings: &RecordSettings,
    seconds: u32,
    paths: &OutputPaths,
) -> Vec<String> {
    let mut a = build_record_args(backend, settings, paths);
    let insert_at = a
        .iter()
        .position(|x| x == "-i")
        .expect("record args always contain an input");
    a.splice(insert_at..insert_at, ["-t".to_string(), seconds.to_string()]);
    a
}

// ---------------------------------------------------------------------------
// Sidecar execution
// ---------------------------------------------------------------------------

/// Runs a sidecar to completion and returns (stdout, stderr).
///
/// The exit status is deliberately not checked: several of the things this app
/// asks FFmpeg to do (`-list_devices`, `-list_options`, probing an unsupported
/// mode on purpose) exit non-zero *by design* and put the answer on stderr.
pub async fn run_tool(app: &AppHandle, tool: &str, args: Vec<String>) -> Result<(String, String), String> {
    let cmd = app
        .shell()
        .sidecar(tool)
        .map_err(|e| format!("{tool} sidecar is missing — run `npm run ffmpeg` to fetch it ({e})"))?;
    let out = cmd
        .args(args)
        .output()
        .await
        .map_err(|e| format!("could not start {tool}: {e}"))?;
    Ok((
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    ))
}

/// First line of `ffmpeg -version`, stamped into every recording manifest so a
/// file can always be traced back to the encoder that produced it.
pub async fn ffmpeg_version(app: &AppHandle) -> Result<String, String> {
    let (stdout, stderr) = run_tool(app, "ffmpeg", vec!["-version".into()]).await?;
    let text = if stdout.trim().is_empty() { stderr } else { stdout };
    Ok(text.lines().next().unwrap_or("unknown").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> RecordSettings {
        RecordSettings {
            video_device_token: "CAM".into(),
            audio: Some(AudioSettings {
                device_token: "MIC".into(),
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

    fn paths() -> OutputPaths {
        OutputPaths {
            capture: "out.mkv".into(),
            preview: "preview.jpg".into(),
        }
    }

    fn pair(args: &[String], flag: &str) -> Option<String> {
        args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
    }

    #[test]
    fn always_forces_constant_frame_rate() {
        let a = build_record_args(CaptureBackend::DirectShow, &settings(), &paths());
        assert_eq!(pair(&a, "-fps_mode").as_deref(), Some("cfr"));
        assert_eq!(pair(&a, "-r").as_deref(), Some("30"));
    }

    #[test]
    fn compressed_input_uses_vcodec_not_pixel_format() {
        // Getting this backwards is how a webcam silently ends up at 5 fps.
        let a = build_record_args(CaptureBackend::DirectShow, &settings(), &paths());
        assert_eq!(pair(&a, "-vcodec").as_deref(), Some("mjpeg"));
        assert!(!a.iter().any(|x| x == "-pixel_format" ));
    }

    #[test]
    fn raw_input_uses_pixel_format_not_vcodec() {
        let mut s = settings();
        s.input_format = Some("yuyv422".into());
        s.input_is_compressed = false;
        let a = build_record_args(CaptureBackend::DirectShow, &s, &paths());
        assert_eq!(pair(&a, "-pixel_format").as_deref(), Some("yuyv422"));
    }

    #[test]
    fn gop_is_two_seconds_of_frames() {
        let a = build_record_args(CaptureBackend::DirectShow, &settings(), &paths());
        assert_eq!(pair(&a, "-g").as_deref(), Some("60"));
    }

    #[test]
    fn cbr_pins_maxrate_and_bufsize() {
        let a = build_record_args(CaptureBackend::DirectShow, &settings(), &paths());
        assert_eq!(pair(&a, "-b:v").as_deref(), Some("12000k"));
        assert_eq!(pair(&a, "-maxrate").as_deref(), Some("12000k"));
        assert_eq!(pair(&a, "-bufsize").as_deref(), Some("24000k"));
    }

    #[test]
    fn video_only_omits_every_audio_flag() {
        let mut s = settings();
        s.audio = None;
        let a = build_record_args(CaptureBackend::DirectShow, &s, &paths());
        assert!(!a.iter().any(|x| x == "-c:a"));
        assert!(!a.iter().any(|x| x == "ebur128=peak=true"));
        assert_eq!(pair(&a, "-i").as_deref(), Some("video=CAM"));
    }

    #[test]
    fn dshow_combines_video_and_audio_into_one_input() {
        assert_eq!(
            build_input_spec(CaptureBackend::DirectShow, "CAM", Some("MIC")),
            "video=CAM:audio=MIC"
        );
    }

    #[test]
    fn avfoundation_uses_none_for_missing_audio() {
        assert_eq!(build_input_spec(CaptureBackend::AvFoundation, "1", None), "1:none");
        assert_eq!(build_input_spec(CaptureBackend::AvFoundation, "1", Some("0")), "1:0");
    }

    #[test]
    fn progress_goes_to_stdout_so_stderr_stays_free_for_logs() {
        let a = build_record_args(CaptureBackend::DirectShow, &settings(), &paths());
        assert_eq!(pair(&a, "-progress").as_deref(), Some("pipe:1"));
    }

    #[test]
    fn cbr_size_estimate_is_arithmetic() {
        // 12000 kbps video + 128 kbps audio over 600 s ~= 848 MB.
        let s = settings();
        let per_sec = s.estimated_bytes_per_second().unwrap();
        assert_eq!(per_sec, 12_128 * 125);
        let ten_minutes = per_sec * 600;
        assert!((ten_minutes as f64 / 1e6 - 909.6).abs() < 1.0);
    }

    #[test]
    fn crf_has_no_derivable_size() {
        let mut s = settings();
        s.rate_control = RateControl::Crf { crf: 20 };
        assert!(s.estimated_bytes_per_second().is_none());
    }

    #[test]
    fn remux_never_re_encodes() {
        let a = build_remux_args("in.mkv", "out.mp4", 30);
        assert!(a.windows(2).any(|w| w[0] == "-c" && w[1] == "copy"));
        assert!(!a.iter().any(|x| x.starts_with("libx264")));
    }

    #[test]
    fn remux_pins_a_timebase_that_divides_the_frame_rate() {
        // Measured on real output: the muxer default of 1000 leaves frames up
        // to 0.667 ms off the grid. fps x 1000 makes every frame a whole tick.
        assert_eq!(mp4_timescale(30), 30_000);
        assert_eq!(mp4_timescale(60), 60_000);
        assert_eq!(mp4_timescale(0), 1000, "never emit a zero timescale");
        let a = build_remux_args("in.mkv", "out.mp4", 30);
        assert_eq!(pair(&a, "-video_track_timescale").as_deref(), Some("30000"));
    }

    #[test]
    fn preflight_limits_the_input_not_an_output() {
        // As an output option, -t ends only that output; FFmpeg keeps running
        // to serve the preview and never exits. Verified the hard way.
        let a = build_preflight_args(CaptureBackend::DirectShow, &settings(), 5, &paths());
        let t_at = a.iter().position(|x| x == "-t").expect("-t present");
        let i_at = a.iter().position(|x| x == "-i").expect("-i present");
        assert!(t_at < i_at, "-t must precede -i to bound the whole run");
        assert_eq!(a[t_at + 1], "5");
    }

    #[test]
    fn preflight_rehearses_the_real_encoder_settings() {
        // A preflight that tests a different pipeline than the take would pass
        // while the take fails. Same encoder, same bitrate, same rate control.
        let s = settings();
        let pre = build_preflight_args(CaptureBackend::DirectShow, &s, 5, &paths());
        let real = build_record_args(CaptureBackend::DirectShow, &s, &paths());
        assert_eq!(pair(&pre, "-c:v"), pair(&real, "-c:v"));
        assert_eq!(pair(&pre, "-b:v"), pair(&real, "-b:v"));
        assert_eq!(pair(&pre, "-fps_mode"), pair(&real, "-fps_mode"));
        assert_eq!(pair(&pre, "-vcodec"), pair(&real, "-vcodec"));
        assert_eq!(pre.len(), real.len() + 2, "only -t is added");
    }
}
