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
pub const ENCODER_CANDIDATES: [&str; 4] = ["h264_qsv", "h264_nvenc", "h264_amf", "libx264"];

/// The probe's resolution matters. A driver can accept a 640x480 session and
/// refuse 1080p, so the answer is cached per resolution rather than globally:
/// (width, height) -> encoder name.
static DETECTED_ENCODER: Mutex<Vec<((u32, u32), String)>> = Mutex::new(Vec::new());

/// Encoders this process has seen fail for real, after the probe accepted them.
///
/// A probe is a prediction; a capture is evidence. When an encoder opens on
/// synthetic frames and then dies on the actual camera — which is exactly how
/// Room C failed on 2026-09-11 — the name goes in here and is skipped for the
/// rest of the run, including by every later probe.
static REJECTED_ENCODERS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Mark an encoder as proven broken on this machine and forget every cached
/// choice that named it, so the next `best_encoder` picks something else.
pub fn forget_encoder(encoder: &str) {
    if let Ok(mut rejected) = REJECTED_ENCODERS.lock() {
        if !rejected.iter().any(|e| e == encoder) {
            rejected.push(encoder.to_string());
        }
    }
    if let Ok(mut cache) = DETECTED_ENCODER.lock() {
        cache.retain(|(_, name)| name != encoder);
    }
}

fn is_rejected(encoder: &str) -> bool {
    REJECTED_ENCODERS
        .lock()
        .map(|r| r.iter().any(|e| e == encoder))
        .unwrap_or(false)
}

/// FFmpeg lines that mean "the encoder never opened", as distinct from the
/// camera not delivering. Room C produced the first three of these.
///
/// Deliberately specific. A false positive here is worse than a false
/// negative: it makes `start_recording` cycle encoders over a fault that is
/// really the camera's, and Preflight blame the wrong component. A miss only
/// costs the automatic retry. So `failed to create` on its own is not in the
/// list — dshow has its own "could not create" phrasings — and the AMF case
/// is matched by the part of its message that names a GPU.
const ENCODER_FAILURE_MARKERS: [&str; 6] = [
    "error creating a mfx session",
    "could not open encoder",
    "error while opening encoder",
    "hardware device context",
    "no capable devices found",
    "cannot load nvcuda",
];

/// Does this FFmpeg stderr name an encoder that refused to start?
///
/// Used to tell an encoder failure apart from a camera failure — Preflight
/// reported the former as "Camera opens" before, which sent Randy looking at
/// the webcam for a problem that was in the GPU driver.
pub fn stderr_blames_the_encoder(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    ENCODER_FAILURE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

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

/// How much more bitrate this family needs to match x264's picture.
///
/// One definition, used by both the encoder arguments and the disk forecast.
/// They were separate before, and the forecast quietly stayed a software
/// figure: a 2m39s hardware take measured 392 MB against a predicted 242 MB,
/// so "room for about 112 more sessions" really meant about 66. Under-stating
/// free space is the dangerous direction to be wrong in — the failure it
/// invites is a disk filling up in the middle of a session. (2026-08-18)
pub fn bitrate_scale(family: EncoderFamily) -> f64 {
    if family == EncoderFamily::X264 {
        1.0
    } else {
        1.7
    }
}

/// Does this encoder actually encode on this machine, at this size?
///
/// "Listed in `-encoders`" proves nothing: `h264_qsv`, `h264_nvenc` and
/// `h264_amf` are compiled into the pinned build and are listed on every
/// machine on earth, working driver or not. So the candidate has to encode
/// real frames to nowhere and **exit zero**.
///
/// The exit status is the whole point of this function. The version of this
/// code shipped in v1.0.0 tested candidates with `run_tool(..).is_ok()`, which
/// is true whenever the process merely *spawned* — so every machine chose
/// `h264_qsv`, the first candidate, whether or not it had Intel Quick Sync.
/// Room C did not, FFmpeg died with `Error creating a MFX session: -9` before
/// writing a byte, and a 10-minute conversation was lost to a 0-byte file
/// (2026-09-11). `run_tool` still ignores exit status on purpose — device
/// enumeration depends on that — so this asks the question separately.
///
/// The size matters too: a driver can accept 640x480 and refuse 1080p, so the
/// probe runs at the resolution the session will actually use.
pub async fn probe_encoder(app: &AppHandle, encoder: &str, width: u32, height: u32) -> bool {
    if is_rejected(encoder) {
        return false;
    }
    if encoder == "libx264" {
        // The software fallback ships inside the pinned build and has no
        // driver to be missing. If it is broken, nothing else can be trusted
        // either, and the capture itself will say so.
        return true;
    }

    let args: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        &format!("nullsrc=s={width}x{height}:r=30:d=0.3"),
        "-c:v",
        encoder,
        "-f",
        "null",
        "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    matches!(run_tool_status(app, "ffmpeg", args).await, Ok((_, _, true)))
}

/// The best encoder this machine can actually run at this resolution.
///
/// Probed once per (width, height) per process, and re-probed if a capture
/// later proves the choice wrong (see `forget_encoder`). `libx264` is the
/// floor: it always ends the loop, so this always returns something.
pub async fn best_encoder(app: &AppHandle, width: u32, height: u32) -> String {
    if let Ok(cache) = DETECTED_ENCODER.lock() {
        if let Some((_, found)) = cache.iter().find(|((w, h), _)| *w == width && *h == height) {
            return found.clone();
        }
    }

    let mut chosen = "libx264".to_string();
    for candidate in ENCODER_CANDIDATES {
        if probe_encoder(app, candidate, width, height).await {
            chosen = candidate.to_string();
            break;
        }
    }

    if let Ok(mut cache) = DETECTED_ENCODER.lock() {
        cache.retain(|((w, h), _)| !(*w == width && *h == height));
        cache.push(((width, height), chosen.clone()));
    }
    chosen
}

/// The next candidate after `current`, skipping anything already proven broken.
///
/// Drives the one automatic retry in `start_recording`: when an encoder dies on
/// the real camera, the session moves down the list rather than handing the RA
/// a 0-byte file.
pub async fn next_encoder_after(
    app: &AppHandle,
    current: &str,
    width: u32,
    height: u32,
) -> Option<String> {
    let start = ENCODER_CANDIDATES.iter().position(|c| *c == current)?;
    for candidate in ENCODER_CANDIDATES.iter().skip(start + 1) {
        if probe_encoder(app, candidate, width, height).await {
            return Some((*candidate).to_string());
        }
    }
    None
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
    let bitrate_scale = bitrate_scale(family);

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

    // Rate control. Constant bitrate is the wrong instrument for a webcam:
    // sensor noise is expensive to encode, a fixed ceiling spends the budget
    // evenly whether the frame needs it or not, and the result blocks up on
    // exactly the faces this study measures. Quality-targeted modes let the
    // encoder spend where the picture is, and the ceiling below still keeps
    // file size predictable for the Research Drive.
    match family {
        EncoderFamily::X264 => {
            if let RateControl::Crf { crf } = settings.rate_control {
                push(a, "-crf");
                a.push(crf.to_string());
            } else {
                // maxrate == bitrate with a 2x buffer is what actually pins
                // the size; -b:v alone is only an average target.
                push(a, "-b:v");
                a.push(format!("{kbps}k"));
                push(a, "-maxrate");
                a.push(format!("{kbps}k"));
                push(a, "-bufsize");
                a.push(format!("{}k", kbps * 2));
            }
        }
        // Hardware encoders: an explicit bitrate, deliberately, after trying
        // the quality-targeted modes and measuring them.
        //
        // QSV's ICQ (-global_quality) is silently ignored by this driver —
        // asking for 14 produced *less* bitrate than asking for 18, which is
        // not a quality scale doing anything. Rather than ship a knob that
        // only appears to work, the hardware path states the bitrate it
        // wants. That is also the more predictable thing for a lab: a
        // 10-minute conversation costs about the same on every machine, so
        // Research Drive space can be planned rather than discovered.
        //
        // VBR rather than CBR: the peak is what protects detail during
        // movement, and there is no reason to pad a still frame up to the
        // ceiling.
        EncoderFamily::Qsv | EncoderFamily::Nvenc | EncoderFamily::Amf => {
            push(a, "-b:v");
            a.push(format!("{kbps}k"));
            push(a, "-maxrate");
            a.push(format!("{}k", kbps * 3 / 2));
            push(a, "-bufsize");
            a.push(format!("{}k", kbps * 2));
        }
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
    ///
    /// `family` must be the encoder that will actually run, because a hardware
    /// encoder is handed `bitrate_scale` times the nominal rate; quoting the
    /// nominal figure understated real files by that factor.
    pub fn estimated_bytes_per_second(&self, family: EncoderFamily) -> Option<u64> {
        let RateControl::Cbr { kbps } = self.rate_control else {
            return None;
        };
        let video_kbps = f64::from(kbps) * bitrate_scale(family);
        let audio_kbps = self.audio.as_ref().map(|a| a.bitrate_kbps).unwrap_or(0);
        Some(((video_kbps + f64::from(audio_kbps)) * 125.0) as u64)
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
///
/// Callers that need "did this actually work?" must use `run_tool_status`.
/// Treating `Ok(..)` from this function as success is what selected a
/// non-functional encoder on every lab machine until 2026-09-12.
pub async fn run_tool(app: &AppHandle, tool: &str, args: Vec<String>) -> Result<(String, String), String> {
    let (stdout, stderr, _) = run_tool_status(app, tool, args).await?;
    Ok((stdout, stderr))
}

/// `run_tool`, plus whether the process exited zero.
///
/// `Err` still means the sidecar could not be started at all; the third tuple
/// field is FFmpeg's own verdict on the work it was asked to do.
pub async fn run_tool_status(
    app: &AppHandle,
    tool: &str,
    args: Vec<String>,
) -> Result<(String, String, bool), String> {
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
        out.status.success(),
    ))
}

/// Same as `run_tool`, but keeps stdout as bytes.
///
/// `run_tool` decodes stdout with from_utf8_lossy, which is right for FFmpeg's
/// text output and quietly destroys binary: every byte that is not valid UTF-8
/// becomes U+FFFD, so a JPEG that came back through it is corrupt in a way
/// nothing downstream can detect. Anything asking FFmpeg to write an image to
/// stdout comes through here instead.
pub async fn run_tool_bytes(
    app: &AppHandle,
    tool: &str,
    args: Vec<String>,
) -> Result<Vec<u8>, String> {
    let cmd = app
        .shell()
        .sidecar(tool)
        .map_err(|e| format!("{tool} sidecar is missing — run `npm run ffmpeg` to fetch it ({e})"))?;
    let out = cmd
        .args(args)
        .output()
        .await
        .map_err(|e| format!("could not start {tool}: {e}"))?;
    Ok(out.stdout)
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
        let per_sec = s
            .estimated_bytes_per_second(EncoderFamily::X264)
            .unwrap();
        assert_eq!(per_sec, 12_128 * 125);
        let ten_minutes = per_sec * 600;
        assert!((ten_minutes as f64 / 1e6 - 909.6).abs() < 1.0);
    }

    /// The forecast must track what the hardware path is actually handed, or
    /// it under-reports every file the lab records on a machine with an iGPU.
    #[test]
    fn hardware_estimate_follows_the_bitrate_it_is_given() {
        let s = settings();
        let software = s
            .estimated_bytes_per_second(EncoderFamily::X264)
            .unwrap();
        let hardware = s.estimated_bytes_per_second(EncoderFamily::Qsv).unwrap();

        // Video is scaled, audio is not, so the ratio sits just under 1.7.
        assert!(hardware > software);
        let video_only_ratio =
            (hardware as f64 - 128.0 * 125.0) / (software as f64 - 128.0 * 125.0);
        assert!((video_only_ratio - bitrate_scale(EncoderFamily::Qsv)).abs() < 0.01);

        // The measured case that exposed this: a hardware take ran ~148 MB/min
        // where the old software-only figure predicted ~91 MB/min.
        let mb_per_min = hardware as f64 * 60.0 / 1e6;
        assert!((mb_per_min - 153.0).abs() < 6.0, "{mb_per_min} MB/min");
    }

    #[test]
    fn crf_has_no_derivable_size() {
        let mut s = settings();
        s.rate_control = RateControl::Crf { crf: 20 };
        assert!(s
            .estimated_bytes_per_second(EncoderFamily::X264)
            .is_none());
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

    // ---- encoder selection -------------------------------------------------

    #[test]
    fn software_is_the_last_candidate_and_every_other_one_is_hardware() {
        // `best_encoder` walks this list in order and stops at the first that
        // passes. If libx264 were not last, a machine with no working GPU
        // encoder would fall off the end with nothing chosen.
        assert_eq!(*ENCODER_CANDIDATES.last().unwrap(), "libx264");
        assert!(
            ENCODER_CANDIDATES[..ENCODER_CANDIDATES.len() - 1]
                .iter()
                .all(|c| *c != "libx264"),
            "libx264 must appear exactly once, at the end"
        );
    }

    /// Room C's FFmpeg output, 2026-09-11.
    ///
    /// Preflight reported this as "Camera opens ✗", which sent everyone
    /// looking at a webcam that was working perfectly.
    #[test]
    fn a_failed_mfx_session_is_recognised_as_the_encoders_fault() {
        let room_c = concat!(
            "[h264_qsv @ 0000] Error creating a MFX session: -9.\n",
            "[h264_qsv @ 0000] The current mfx implementation is not supported, try next mfx implementation.\n",
            "[vost#0:0/h264_qsv @ 0000] [enc:h264_qsv @ 0000] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.\n",
            "[vost#0:0/h264_qsv @ 0000] [enc:h264_qsv @ 0000] Could not open encoder before EOF\n",
            "[out#0/matroska @ 0000] Nothing was written into output file, because at least one of its streams received no packets.",
        );
        assert!(stderr_blames_the_encoder(room_c));
    }

    /// A real capture, not a paraphrase.
    ///
    /// Room C could not be borrowed to test against, so its failure was
    /// reproduced on the development machine on 2026-09-12 by running the
    /// app's own record arguments against the real webcam with `h264_amf` —
    /// an encoder this machine lists and cannot run, exactly as Room C listed
    /// and could not run `h264_qsv`. The capture produced a 0-byte MKV, and
    /// these are the lines FFmpeg actually printed.
    const REAL_AMF_FAILURE: &str = concat!(
        "[AMF @ 000001f5ec7fdc00] DLL amfrt64.dll failed to open\n",
        "[h264_amf @ 000001f5e3309100] Failed to create  hardware device context (AMF) : Unknown error occurred\n",
        "[vost#0:0/h264_amf @ 000001f5e10e5140] [enc:h264_amf @ 000001f5e32c0f80] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.\n",
        "[vf#0:0 @ 000001f5e0957b40] Error sending frames to consumers: Unknown error occurred\n",
        "[vost#0:0/h264_amf @ 000001f5e10e5140] [enc:h264_amf @ 000001f5e32c0f80] Could not open encoder before EOF\n",
        "[out#0/matroska @ 000001f5e328ac00] Nothing was written into output file, because at least one of its streams received no packets.",
    );

    #[test]
    fn the_other_vendors_failures_are_recognised_too() {
        assert!(stderr_blames_the_encoder(REAL_AMF_FAILURE));
        assert!(stderr_blames_the_encoder(
            "[h264_nvenc @ 0000] Cannot load nvcuda.dll"
        ));
    }

    #[test]
    fn a_camera_failure_is_not_blamed_on_the_encoder() {
        // The distinction the preflight check turns on. These are real dshow
        // failures and none of them should route to the encoder row. A false
        // positive here would have start_recording cycle encoders over a
        // camera fault, and Preflight point at the wrong component.
        for camera in [
            "[dshow @ 0000] Could not run graph (sync)",
            "[dshow @ 0000] Could not create capture filter",
            "[dshow @ 0000] Could not find video device with name",
            "[dshow @ 0000] Could not set video options",
            "[dshow @ 0000] real-time buffer [Logitech BRIO] [video input] too full or near too full",
            "[in#0/dshow @ 0000] Error during demuxing: I/O error",
            "[in#0 @ 0000] Error opening input: I/O error",
            "frame dropped!",
        ] {
            assert!(
                !stderr_blames_the_encoder(camera),
                "{camera:?} is a camera problem, not an encoder one"
            );
        }
    }

    #[test]
    fn an_empty_log_blames_nobody() {
        assert!(!stderr_blames_the_encoder(""));
    }

    #[test]
    fn forgetting_an_encoder_stops_it_being_probed_again() {
        // The safety net behind the record-time fallback: once a capture has
        // proved an encoder broken, no later probe in this process may hand it
        // back. Uses a name no machine has, so it cannot disturb a real one.
        let fake = "h264_not_a_real_encoder_for_tests";
        assert!(!is_rejected(fake));
        forget_encoder(fake);
        assert!(is_rejected(fake));
        forget_encoder(fake);
        assert_eq!(
            REJECTED_ENCODERS.lock().unwrap().iter().filter(|e| *e == fake).count(),
            1,
            "rejecting twice must not duplicate the entry"
        );
        REJECTED_ENCODERS.lock().unwrap().retain(|e| e != fake);
    }

    #[test]
    fn the_fallback_order_walks_down_the_list() {
        // next_encoder_after needs a real AppHandle to probe, so this covers
        // the part that is pure: where in the list each candidate sits.
        let qsv = ENCODER_CANDIDATES.iter().position(|c| *c == "h264_qsv").unwrap();
        let x264 = ENCODER_CANDIDATES.iter().position(|c| *c == "libx264").unwrap();
        assert!(qsv < x264, "hardware is tried before software");
        assert!(ENCODER_CANDIDATES.iter().position(|c| *c == "nope").is_none());
    }
}
