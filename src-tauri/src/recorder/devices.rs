// Camera and microphone discovery, and — the part that matters — asking each
// camera what it can actually do.
//
// This app is device-agnostic by design. Nothing is hardcoded to the BRIO: the
// resolution and frame-rate choices offered in the UI are built from the mode
// list the attached camera itself advertises, so the app can only ever ask for
// something the hardware said it supports. A small profile table on top of that
// applies known-good tuning for cameras we recognise (see PROFILES).
//
// The reason this is not just "offer 1080p30 and hope": on most UVC webcams the
// uncompressed pixel formats are bandwidth-starved over USB and negotiate down
// to about 5 fps at 1080p, while the MJPEG mode of the same camera does a
// comfortable 30. Both are "1080p" as far as a naive settings dialog is
// concerned. Only one of them produces usable data.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::recorder::ffmpeg::{run_tool, CaptureBackend};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub kind: DeviceKind,
    /// What a human sees in the picker.
    pub name: String,
    /// The token handed to FFmpeg right now. On Windows this is the DirectShow
    /// "alternative name" when one exists, because two identical webcams share
    /// a friendly name and differ only here. On macOS it is the AVFoundation
    /// index, which is positional and must be re-resolved every run.
    pub token: String,
    /// Stable identity used to re-find this device on a later run. Windows: the
    /// alternative name, which embeds the USB path. macOS: the device name,
    /// because AVFoundation exposes nothing better through FFmpeg.
    pub fingerprint: String,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    /// Label of the matched entry in PROFILES, if any.
    pub profile: Option<String>,
    pub profile_note: Option<String>,
}

/// One (input format, resolution, frame-rate range) combination the camera says
/// it supports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMode {
    /// `mjpeg`, `yuyv422`, `nv12`, ... or `auto` when the backend won't say.
    pub format: String,
    /// True for MJPEG/H.264 style modes. Determines whether dshow wants
    /// `-vcodec` or `-pixel_format`, and drives mode ranking.
    pub compressed: bool,
    pub width: u32,
    pub height: u32,
    pub min_fps: f64,
    pub max_fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraCapabilities {
    pub modes: Vec<VideoMode>,
    /// False when the camera could not be interrogated and `modes` is a
    /// conservative standard ladder rather than the device's own answer. The UI
    /// says so rather than implying certainty it does not have.
    pub probed: bool,
    pub note: String,
}

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

pub struct DeviceProfile {
    pub label: &'static str,
    pub vid: &'static str,
    /// Empty means "any product from this vendor".
    pub pids: &'static [&'static str],
    pub name_contains: &'static [&'static str],
    /// Input formats in preference order, best first. This is a *ranking*, not
    /// an allowlist: a format that is not listed ranks last but is still
    /// eligible, so a camera that offers nothing else remains usable. What
    /// actually keeps a camera off an unusable mode is the frame-rate filter in
    /// select_mode, which rejects any mode that never advertised the requested
    /// rate.
    pub preferred_formats: &'static [&'static str],
    pub note: &'static str,
}

/// Ranking used for any camera we do not recognise. MJPEG first because it is
/// the only way most USB webcams reach full frame rate at 1080p, but raw
/// formats stay in the list — plenty of cheap cameras only offer YUY2 and work
/// perfectly well at lower resolutions.
pub const GENERIC_FORMAT_PREFERENCE: &[&str] =
    &["mjpeg", "mjpg", "h264", "nv12", "yuyv422", "yuy2", "uyvy422", "yuv420p", "rgb24"];

pub const PROFILES: &[DeviceProfile] = &[
    DeviceProfile {
        label: "Logitech BRIO",
        vid: "046d",
        pids: &["085e"],
        name_contains: &["brio"],
        // MJPEG first and nothing else listed: the BRIO's uncompressed mode
        // negotiates to roughly 5 fps at 1080p, so whenever both are on offer
        // for the requested rate, MJPEG must win.
        preferred_formats: &["mjpeg", "mjpg"],
        note: "Recording at 1080p uses the BRIO's MJPEG mode — its uncompressed mode runs near 5 fps at this resolution. 1080p60 and 4K are available if the machine can keep up. Has a dual-microphone array.",
    },
    DeviceProfile {
        label: "Logitech webcam",
        vid: "046d",
        pids: &[],
        name_contains: &["logitech", "c920", "c922", "c930", "streamcam"],
        preferred_formats: &["mjpeg", "mjpg", "nv12", "yuyv422"],
        note: "Logitech UVC camera — MJPEG input is preferred so 1080p holds full frame rate.",
    },
    DeviceProfile {
        label: "Elgato capture device",
        vid: "0fd9",
        pids: &[],
        name_contains: &["elgato", "cam link"],
        preferred_formats: &["mjpeg", "nv12", "yuyv422"],
        note: "Capture device — the frame rate it delivers is set by whatever is plugged into it.",
    },
];

pub fn match_profile(
    name: &str,
    vendor_id: Option<&str>,
    product_id: Option<&str>,
) -> Option<&'static DeviceProfile> {
    let lower = name.to_ascii_lowercase();
    // A vendor+product match is decisive; a name match is a good guess. Check
    // the decisive one across every profile before falling back to guessing,
    // otherwise a generic "Logitech webcam" entry would shadow the BRIO.
    if let Some(vid) = vendor_id {
        let vid = vid.to_ascii_lowercase();
        for p in PROFILES {
            if p.vid == vid && !p.pids.is_empty() {
                if let Some(pid) = product_id {
                    if p.pids.contains(&pid.to_ascii_lowercase().as_str()) {
                        return Some(p);
                    }
                }
            }
        }
        for p in PROFILES {
            if p.vid == vid && p.pids.is_empty() {
                return Some(p);
            }
        }
    }
    PROFILES
        .iter()
        .find(|p| p.name_contains.iter().any(|n| lower.contains(n)))
}

pub fn format_preference(profile: Option<&DeviceProfile>) -> &'static [&'static str] {
    profile.map_or(GENERIC_FORMAT_PREFERENCE, |p| p.preferred_formats)
}

// ---------------------------------------------------------------------------
// Parsing — pure, and therefore tested
// ---------------------------------------------------------------------------

/// Strips FFmpeg's `[dshow @ 0x...]` / `[AVFoundation indev @ 0x...]` prefix.
fn strip_log_prefix(line: &str) -> &str {
    let t = line.trim();
    if t.starts_with('[') {
        if let Some(end) = t.find(']') {
            return t[end + 1..].trim();
        }
    }
    t
}

fn first_quoted(s: &str) -> Option<String> {
    let start = s.find('"')? + 1;
    let rest = &s[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Pulls `vid_046d` / `pid_085e` out of a DirectShow alternative name.
fn usb_ids(alt_name: &str) -> (Option<String>, Option<String>) {
    let lower = alt_name.to_ascii_lowercase();
    let grab = |key: &str| -> Option<String> {
        let at = lower.find(key)? + key.len();
        let tail: String = lower[at..].chars().take_while(|c| c.is_ascii_hexdigit()).collect();
        (tail.len() == 4).then_some(tail)
    };
    (grab("vid_"), grab("pid_"))
}

/// Parses `ffmpeg -list_devices true -f dshow -i dummy` (which writes to stderr
/// and exits non-zero — both expected).
///
/// Handles both layouts FFmpeg has shipped: the modern one that tags each line
/// `(video)` / `(audio)`, and the older one that relies on section headers.
pub fn parse_dshow_devices(stderr: &str) -> Vec<Device> {
    let mut out: Vec<Device> = Vec::new();
    let mut section: Option<DeviceKind> = None;

    for raw in stderr.lines() {
        let line = strip_log_prefix(raw);
        let lower = line.to_ascii_lowercase();

        if lower.contains("directshow video devices") {
            section = Some(DeviceKind::Video);
            continue;
        }
        if lower.contains("directshow audio devices") {
            section = Some(DeviceKind::Audio);
            continue;
        }

        if lower.starts_with("alternative name") {
            if let (Some(alt), Some(last)) = (first_quoted(line), out.last_mut()) {
                let (vid, pid) = usb_ids(&alt);
                last.token = alt.clone();
                last.fingerprint = alt;
                last.vendor_id = vid;
                last.product_id = pid;
                if let Some(p) = match_profile(
                    &last.name,
                    last.vendor_id.as_deref(),
                    last.product_id.as_deref(),
                ) {
                    last.profile = Some(p.label.to_string());
                    last.profile_note = Some(p.note.to_string());
                }
            }
            continue;
        }

        if !line.starts_with('"') {
            continue;
        }
        let Some(name) = first_quoted(line) else { continue };
        let kind = if lower.ends_with("(video)") {
            Some(DeviceKind::Video)
        } else if lower.ends_with("(audio)") {
            Some(DeviceKind::Audio)
        } else {
            section
        };
        let Some(kind) = kind else { continue };

        let profile = match_profile(&name, None, None);
        out.push(Device {
            kind,
            token: name.clone(),
            fingerprint: name.clone(),
            name,
            vendor_id: None,
            product_id: None,
            profile: profile.map(|p| p.label.to_string()),
            profile_note: profile.map(|p| p.note.to_string()),
        });
    }
    out
}

/// Parses `ffmpeg -f dshow -list_options true -i video=NAME`.
///
/// Lines look like:
///   vcodec=mjpeg  min s=1920x1080 fps=5 max s=1920x1080 fps=30
///   pixel_format=yuyv422  min s=640x480 fps=5 max s=640x480 fps=30
pub fn parse_dshow_options(stderr: &str) -> Vec<VideoMode> {
    let mut modes: Vec<VideoMode> = Vec::new();

    for raw in stderr.lines() {
        let line = strip_log_prefix(raw);
        if !line.contains("vcodec=") && !line.contains("pixel_format=") {
            continue;
        }

        let mut format: Option<(String, bool)> = None;
        let (mut min_w, mut min_h, mut max_w, mut max_h) = (0u32, 0u32, 0u32, 0u32);
        let (mut min_fps, mut max_fps) = (0.0f64, 0.0f64);
        let mut phase = 0u8; // 1 = reading the min side, 2 = the max side

        for tok in line.split_whitespace() {
            if let Some(v) = tok.strip_prefix("vcodec=") {
                format = Some((v.to_string(), true));
            } else if let Some(v) = tok.strip_prefix("pixel_format=") {
                format = Some((v.to_string(), false));
            } else if tok == "min" {
                phase = 1;
            } else if tok == "max" {
                phase = 2;
            } else if let Some(v) = tok.strip_prefix("s=") {
                if let Some((w, h)) = v.split_once('x') {
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                        if phase == 2 {
                            max_w = w;
                            max_h = h;
                        } else {
                            min_w = w;
                            min_h = h;
                        }
                    }
                }
            } else if let Some(v) = tok.strip_prefix("fps=") {
                if let Ok(f) = v.parse::<f64>() {
                    match phase {
                        1 => min_fps = f,
                        2 => max_fps = f,
                        _ => {}
                    }
                }
            }
        }

        let Some((fmt, compressed)) = format else { continue };
        // FFmpeg reports a min/max pair; for UVC cameras both sides almost
        // always name the same resolution. Take the larger, and treat a missing
        // max as "same as min".
        let (width, height) = if max_w > 0 { (max_w, max_h) } else { (min_w, min_h) };
        if width == 0 || height == 0 {
            continue;
        }
        if max_fps <= 0.0 {
            max_fps = min_fps;
        }

        let mode = VideoMode {
            format: fmt,
            compressed,
            width,
            height,
            min_fps,
            max_fps,
        };
        // FFmpeg lists the same combination once per pin; collapse duplicates.
        if !modes.contains(&mode) {
            modes.push(mode);
        }
    }
    modes
}

/// Parses `ffmpeg -f avfoundation -list_devices true -i ""`.
pub fn parse_avfoundation_devices(stderr: &str) -> Vec<Device> {
    let mut out = Vec::new();
    let mut section: Option<DeviceKind> = None;

    for raw in stderr.lines() {
        let line = strip_log_prefix(raw);
        let lower = line.to_ascii_lowercase();

        if lower.contains("video devices") {
            section = Some(DeviceKind::Video);
            continue;
        }
        if lower.contains("audio devices") {
            section = Some(DeviceKind::Audio);
            continue;
        }
        let Some(kind) = section else { continue };

        // "[1] Logitech BRIO"
        let Some(rest) = line.strip_prefix('[') else { continue };
        let Some(close) = rest.find(']') else { continue };
        let index = &rest[..close];
        if index.parse::<u32>().is_err() {
            continue;
        }
        let name = rest[close + 1..].trim().to_string();
        if name.is_empty() {
            continue;
        }

        let profile = match_profile(&name, None, None);
        out.push(Device {
            kind,
            token: index.to_string(),
            // AVFoundation indices shift as devices come and go, so the name is
            // the only stable handle FFmpeg gives us. Re-resolved every run.
            fingerprint: name.clone(),
            name,
            vendor_id: None,
            product_id: None,
            profile: profile.map(|p| p.label.to_string()),
            profile_note: profile.map(|p| p.note.to_string()),
        });
    }
    out
}

/// AVFoundation has no `-list_options`. It does, however, print the full mode
/// list as part of the error it raises when asked for a mode it cannot do — so
/// the probe deliberately requests an impossible one and reads the complaint.
///
/// Lines look like:  1920x1080@[1.000000 30.000000]fps
pub fn parse_avfoundation_modes(stderr: &str) -> Vec<VideoMode> {
    let mut modes: Vec<VideoMode> = Vec::new();
    for raw in stderr.lines() {
        let line = strip_log_prefix(raw);
        let Some((dims, rest)) = line.split_once('@') else { continue };
        let Some((w, h)) = dims.trim().split_once('x') else { continue };
        let (Ok(width), Ok(height)) = (w.trim().parse::<u32>(), h.trim().parse::<u32>()) else {
            continue;
        };
        let Some(open) = rest.find('[') else { continue };
        let Some(close) = rest.find(']') else { continue };
        let mut nums = rest[open + 1..close].split_whitespace();
        let min_fps = nums.next().and_then(|n| n.parse::<f64>().ok()).unwrap_or(0.0);
        let max_fps = nums.next().and_then(|n| n.parse::<f64>().ok()).unwrap_or(min_fps);

        let mode = VideoMode {
            // AVFoundation does not name the pixel format in this listing, and
            // letting FFmpeg negotiate is the correct default on macOS.
            format: "auto".to_string(),
            compressed: false,
            width,
            height,
            min_fps,
            max_fps,
        };
        if !modes.contains(&mode) {
            modes.push(mode);
        }
    }
    modes
}

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

/// Frame rates worth offering. UVC cameras report a continuous min/max range
/// rather than a discrete list, so the UI shows the standard rates that fall
/// inside the advertised range.
pub fn standard_fps_within(min_fps: f64, max_fps: f64) -> Vec<u32> {
    [5u32, 10, 15, 20, 24, 25, 30, 50, 60, 90, 120]
        .into_iter()
        .filter(|f| f64::from(*f) >= min_fps - 0.01 && f64::from(*f) <= max_fps + 0.01)
        .collect()
}

fn rank_of(format: &str, preference: &[&str]) -> usize {
    let lower = format.to_ascii_lowercase();
    preference
        .iter()
        .position(|p| *p == lower)
        .unwrap_or(preference.len())
}

/// Picks the mode to actually capture with.
///
/// Only modes the camera advertised for this exact resolution and frame rate
/// are eligible — the app never asks for something the hardware did not claim.
/// Among those, the profile's format preference decides, then higher headroom.
pub fn select_mode<'a>(
    modes: &'a [VideoMode],
    width: u32,
    height: u32,
    fps: u32,
    preference: &[&str],
) -> Option<&'a VideoMode> {
    let target = f64::from(fps);
    modes
        .iter()
        .filter(|m| m.width == width && m.height == height)
        .filter(|m| target >= m.min_fps - 0.01 && target <= m.max_fps + 0.01)
        .min_by(|a, b| {
            rank_of(&a.format, preference)
                .cmp(&rank_of(&b.format, preference))
                .then(b.max_fps.total_cmp(&a.max_fps))
        })
}

/// Distinct resolutions, largest first, each with the frame rates available.
pub fn resolution_options(modes: &[VideoMode]) -> Vec<(u32, u32, Vec<u32>)> {
    let mut out: Vec<(u32, u32, Vec<u32>)> = Vec::new();
    for m in modes {
        let rates = standard_fps_within(m.min_fps, m.max_fps);
        match out.iter_mut().find(|(w, h, _)| *w == m.width && *h == m.height) {
            Some((_, _, existing)) => {
                for r in rates {
                    if !existing.contains(&r) {
                        existing.push(r);
                    }
                }
                existing.sort_unstable();
            }
            None => out.push((m.width, m.height, rates)),
        }
    }
    out.sort_by(|a, b| (b.0 * b.1).cmp(&(a.0 * a.1)));
    out
}

/// Default capture mode for a camera we know nothing about.
///
/// Prefers exactly 1080p30 — the lab's working resolution — then the largest
/// resolution that still manages 30 fps, then whatever the camera's best mode
/// is. A camera that can only do 640x480 is a supported camera, not an error.
pub fn recommend_mode(modes: &[VideoMode], preference: &[&str]) -> Option<(u32, u32, u32)> {
    if select_mode(modes, 1920, 1080, 30, preference).is_some() {
        return Some((1920, 1080, 30));
    }
    let mut best: Option<(u32, u32, u32)> = None;
    for (w, h, rates) in resolution_options(modes) {
        if rates.contains(&30) {
            best = Some((w, h, 30));
            break;
        }
    }
    if best.is_some() {
        return best;
    }
    resolution_options(modes)
        .into_iter()
        .find_map(|(w, h, rates)| rates.last().map(|f| (w, h, *f)))
}

/// The ladder offered when a camera cannot be interrogated. Conservative on
/// purpose: preflight verifies what actually happens before a real session.
pub fn fallback_modes() -> Vec<VideoMode> {
    [(1920u32, 1080u32), (1280, 720), (640, 480)]
        .into_iter()
        .map(|(width, height)| VideoMode {
            format: "auto".into(),
            compressed: false,
            width,
            height,
            min_fps: 5.0,
            max_fps: 30.0,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

pub async fn list_devices(app: &AppHandle) -> Result<Vec<Device>, String> {
    let backend = CaptureBackend::current();
    let args: Vec<String> = match backend {
        CaptureBackend::DirectShow => vec![
            "-hide_banner".into(),
            "-list_devices".into(),
            "true".into(),
            "-f".into(),
            "dshow".into(),
            "-i".into(),
            "dummy".into(),
        ],
        CaptureBackend::AvFoundation => vec![
            "-hide_banner".into(),
            "-f".into(),
            "avfoundation".into(),
            "-list_devices".into(),
            "true".into(),
            "-i".into(),
            String::new(),
        ],
    };

    let (_, stderr) = run_tool(app, "ffmpeg", args).await?;
    Ok(match backend {
        CaptureBackend::DirectShow => parse_dshow_devices(&stderr),
        CaptureBackend::AvFoundation => parse_avfoundation_devices(&stderr),
    })
}

pub async fn probe_camera(app: &AppHandle, token: &str) -> Result<CameraCapabilities, String> {
    let backend = CaptureBackend::current();
    let args: Vec<String> = match backend {
        CaptureBackend::DirectShow => vec![
            "-hide_banner".into(),
            "-f".into(),
            "dshow".into(),
            "-list_options".into(),
            "true".into(),
            "-i".into(),
            format!("video={token}"),
        ],
        // Ask for a mode no camera has, and read the "Supported modes:" list
        // out of the resulting complaint.
        CaptureBackend::AvFoundation => vec![
            "-hide_banner".into(),
            "-f".into(),
            "avfoundation".into(),
            "-video_size".into(),
            "1x1".into(),
            "-framerate".into(),
            "1".into(),
            "-i".into(),
            format!("{token}:none"),
            "-t".into(),
            "0".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ],
    };

    let (_, stderr) = run_tool(app, "ffmpeg", args).await?;
    let modes = match backend {
        CaptureBackend::DirectShow => parse_dshow_options(&stderr),
        CaptureBackend::AvFoundation => parse_avfoundation_modes(&stderr),
    };

    if modes.is_empty() {
        return Ok(CameraCapabilities {
            modes: fallback_modes(),
            probed: false,
            note: "This camera did not report its supported modes, so the list below is a \
                   standard set rather than the camera's own answer. Run Preflight to \
                   confirm what it actually delivers."
                .into(),
        });
    }

    let compressed = modes.iter().filter(|m| m.compressed).count();
    Ok(CameraCapabilities {
        note: format!(
            "{} modes reported by the camera ({} compressed, {} raw).",
            modes.len(),
            compressed,
            modes.len() - compressed
        ),
        modes,
        probed: true,
    })
}

/// Windows only: names cameras the OS knows about that DirectShow cannot reach.
///
/// Many laptop-internal cameras are MIPI sensors behind the Windows Frame
/// Server and are deliberately not exposed to DirectShow, so FFmpeg cannot see
/// them at all. Without this check the app would report "no cameras found" on a
/// machine with a visibly working camera, and the user would reasonably conclude
/// the app is broken. Any USB webcam works fine, which is the actual advice.
#[cfg(target_os = "windows")]
pub fn os_camera_gap(visible_to_ffmpeg: &[Device]) -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' } | \
             Select-Object -ExpandProperty Name",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(out) = out else { return Vec::new() };
    let seen: Vec<String> = visible_to_ffmpeg
        .iter()
        .filter(|d| d.kind == DeviceKind::Video)
        .map(|d| d.name.to_ascii_lowercase())
        .collect();

    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .filter(|n| {
            let lower = n.to_ascii_lowercase();
            !seen.iter().any(|s| s.contains(&lower) || lower.contains(s))
        })
        .map(str::to_string)
        .collect()
}

#[cfg(not(target_os = "windows"))]
pub fn os_camera_gap(_visible_to_ffmpeg: &[Device]) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DSHOW_MODERN: &str = r#"
[dshow @ 000001c0] "Logitech BRIO" (video)
[dshow @ 000001c0]   Alternative name "@device_pnp_\\?\usb#vid_046d&pid_085e&mi_00#7&1ec1a2e&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global"
[dshow @ 000001c0] "HD Pro Webcam C920" (video)
[dshow @ 000001c0]   Alternative name "@device_pnp_\\?\usb#vid_046d&pid_082d&mi_00#6&1ec1a2e&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global"
[dshow @ 000001c0] "Microphone (Logitech BRIO)" (audio)
[dshow @ 000001c0]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\wave_{AAA}"
"#;

    const DSHOW_LEGACY: &str = r#"
[dshow @ 0000023f] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0000023f]  "Integrated Camera"
[dshow @ 0000023f]     Alternative name "@device_pnp_\\?\usb#vid_04f2&pid_b6d9#global"
[dshow @ 0000023f] DirectShow audio devices
[dshow @ 0000023f]  "Microphone Array"
[dshow @ 0000023f]     Alternative name "@device_cm_{GUID}\wave_{BBB}"
"#;

    const DSHOW_OPTIONS: &str = r#"
[dshow @ 000002a] DirectShow video device options (from video devices)
[dshow @ 000002a]  Pin "Capture" (alternative pin name "0")
[dshow @ 000002a]   vcodec=mjpeg  min s=1920x1080 fps=5 max s=1920x1080 fps=60
[dshow @ 000002a]   vcodec=mjpeg  min s=1280x720 fps=5 max s=1280x720 fps=60
[dshow @ 000002a]   pixel_format=yuyv422  min s=1920x1080 fps=5 max s=1920x1080 fps=5 (pc, bt470bg)
[dshow @ 000002a]   pixel_format=yuyv422  min s=640x480 fps=5 max s=640x480 fps=30
"#;

    // Captured verbatim from FFmpeg 9.0 on the development laptop, 2026-08-11.
    // Two things here are load-bearing regressions: FFmpeg 9 renamed the log
    // prefix from "[dshow @ ...]" to "[in#0 @ ...]", and this camera is a MIPI
    // sensor whose alternative name carries no USB vid/pid at all.
    const DSHOW_FFMPEG9_DEVICES: &str = r#"
[in#0 @ 000001a9364a3440] "HP True Vision 5MP Camera" (video)
[in#0 @ 000001a9364a3440]   Alternative name "@device_pnp_\\?\display#int3480#4&17dc34f0&0&uid144512#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\{bd89b7f2-631c-44fb-a505-17ef8b0e2c53}"
[in#0 @ 000001a9364a3440] "OBS Virtual Camera" (video)
[in#0 @ 000001a9364a3440]   Alternative name "@device_sw_{860BB310-5D01-11D0-BD3B-00A0C911CE86}\{A3FCE0F5-3493-419F-958A-ABA1250EC20B}"
[in#0 @ 000001a9364a3440] "Microphone Array (Intel® Smart Sound Technology for Digital Microphones)" (audio)
[in#0 @ 000001a9364a3440]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\wave_{37CFF07E-E68F-45A0-AA1D-6E2FD473D6B2}"
"#;

    // Same machine. Note there is no MJPEG mode whatsoever — this camera is the
    // proof that the generic path carries a camera the BRIO tuning never touches.
    const DSHOW_FFMPEG9_OPTIONS: &str = r#"
[in#0 @ 000002440ba113c0] DirectShow video device options (from video devices)
[in#0 @ 000002440ba113c0]  Pin "Capture" (alternative pin name "Capture")
[in#0 @ 000002440ba113c0]   pixel_format=yuyv422  min s=640x480 fps=30 max s=640x480 fps=30
[in#0 @ 000002440ba113c0]   pixel_format=nv12  min s=640x480 fps=30 max s=640x480 fps=30
[in#0 @ 000002440ba113c0]   pixel_format=yuyv422  min s=1280x720 fps=30 max s=1280x720 fps=30
[in#0 @ 000002440ba113c0]   pixel_format=nv12  min s=1280x720 fps=30 max s=1280x720 fps=30
[in#0 @ 000002440ba113c0]   pixel_format=yuyv422  min s=1920x1080 fps=30 max s=1920x1080 fps=30
[in#0 @ 000002440ba113c0]   pixel_format=nv12  min s=1920x1080 fps=30 max s=1920x1080 fps=30
"#;

    #[test]
    fn parses_ffmpeg9_log_prefix() {
        let d = parse_dshow_devices(DSHOW_FFMPEG9_DEVICES);
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].name, "HP True Vision 5MP Camera");
        assert_eq!(d[1].name, "OBS Virtual Camera");
        assert_eq!(d[2].kind, DeviceKind::Audio);
    }

    #[test]
    fn non_usb_camera_has_no_ids_and_still_works() {
        let d = parse_dshow_devices(DSHOW_FFMPEG9_DEVICES);
        assert!(d[0].vendor_id.is_none());
        assert!(d[0].product_id.is_none());
        assert!(d[0].profile.is_none());
        assert!(d[0].token.starts_with("@device_pnp_"));
    }

    #[test]
    fn camera_without_any_mjpeg_still_gets_1080p30() {
        let m = parse_dshow_options(DSHOW_FFMPEG9_OPTIONS);
        assert_eq!(recommend_mode(&m, GENERIC_FORMAT_PREFERENCE), Some((1920, 1080, 30)));
        // nv12 outranks yuyv422: same frame rate, less USB bandwidth.
        let picked = select_mode(&m, 1920, 1080, 30, GENERIC_FORMAT_PREFERENCE).unwrap();
        assert_eq!(picked.format, "nv12");
        assert!(!picked.compressed);
    }

    const AVF_DEVICES: &str = r#"
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8] [1] Logitech BRIO
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] MacBook Pro Microphone
"#;

    const AVF_MODES: &str = r#"
[avfoundation @ 0x7f9] Supported modes:
[avfoundation @ 0x7f9]   320x240@[1.000000 30.000000]fps
[avfoundation @ 0x7f9]   1280x720@[1.000000 60.000000]fps
[avfoundation @ 0x7f9]   1920x1080@[1.000000 30.000000]fps
"#;

    #[test]
    fn parses_modern_dshow_listing_with_usb_ids() {
        let d = parse_dshow_devices(DSHOW_MODERN);
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].name, "Logitech BRIO");
        assert_eq!(d[0].kind, DeviceKind::Video);
        assert_eq!(d[0].vendor_id.as_deref(), Some("046d"));
        assert_eq!(d[0].product_id.as_deref(), Some("085e"));
        assert_eq!(d[0].profile.as_deref(), Some("Logitech BRIO"));
        assert_eq!(d[2].kind, DeviceKind::Audio);
    }

    #[test]
    fn alternative_name_becomes_the_token() {
        // Two identical cameras share a friendly name; only this disambiguates.
        let d = parse_dshow_devices(DSHOW_MODERN);
        assert!(d[0].token.starts_with("@device_pnp_"));
        assert_ne!(d[0].token, d[1].token);
    }

    #[test]
    fn parses_legacy_dshow_listing_via_section_headers() {
        let d = parse_dshow_devices(DSHOW_LEGACY);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].name, "Integrated Camera");
        assert_eq!(d[0].kind, DeviceKind::Video);
        assert_eq!(d[1].kind, DeviceKind::Audio);
    }

    #[test]
    fn unknown_camera_gets_no_profile_but_still_parses() {
        let d = parse_dshow_devices(DSHOW_LEGACY);
        assert!(d[0].profile.is_none());
    }

    #[test]
    fn parses_dshow_options_including_trailing_noise() {
        let m = parse_dshow_options(DSHOW_OPTIONS);
        assert_eq!(m.len(), 4);
        assert!(m[0].compressed);
        assert_eq!((m[0].width, m[0].height, m[0].max_fps), (1920, 1080, 60.0));
        assert!(!m[2].compressed);
        assert_eq!(m[2].max_fps, 5.0);
    }

    #[test]
    fn selects_mjpeg_over_the_5fps_raw_trap() {
        // The whole point: both entries are "1080p", one of them is unusable.
        let m = parse_dshow_options(DSHOW_OPTIONS);
        let picked = select_mode(&m, 1920, 1080, 30, GENERIC_FORMAT_PREFERENCE).unwrap();
        assert_eq!(picked.format, "mjpeg");
    }

    #[test]
    fn refuses_a_frame_rate_the_camera_never_advertised() {
        let m = parse_dshow_options(DSHOW_OPTIONS);
        assert!(select_mode(&m, 640, 480, 60, GENERIC_FORMAT_PREFERENCE).is_none());
    }

    /// A BRIO as it actually reports itself: MJPEG carries the full range at
    /// 1080p, the uncompressed mode collapses to 5 fps at the same resolution.
    fn brio_like_modes() -> Vec<VideoMode> {
        vec![
            VideoMode {
                format: "mjpeg".into(),
                compressed: true,
                width: 1920,
                height: 1080,
                min_fps: 5.0,
                max_fps: 60.0,
            },
            VideoMode {
                format: "yuyv422".into(),
                compressed: false,
                width: 1920,
                height: 1080,
                min_fps: 5.0,
                max_fps: 5.0,
            },
        ]
    }

    #[test]
    fn the_frame_rate_filter_is_what_excludes_the_5fps_trap() {
        // Structural, and independent of any profile: a mode that never claimed
        // 30 fps cannot be chosen for a 30 fps request, whatever its format.
        let modes = brio_like_modes();
        let picked = select_mode(&modes, 1920, 1080, 30, GENERIC_FORMAT_PREFERENCE).unwrap();
        assert_eq!(picked.format, "mjpeg");
        assert_eq!(picked.max_fps, 60.0);
    }

    #[test]
    fn brio_profile_prefers_mjpeg_when_both_modes_qualify() {
        // At 5 fps the raw mode is eligible too, so only the ranking separates
        // them — and for this camera MJPEG must still win.
        let brio = match_profile("Logitech BRIO", Some("046d"), Some("085e")).unwrap();
        assert_eq!(brio.label, "Logitech BRIO");
        let modes = brio_like_modes();
        let picked = select_mode(&modes, 1920, 1080, 5, brio.preferred_formats).unwrap();
        assert_eq!(picked.format, "mjpeg");
    }

    #[test]
    fn a_profile_ranking_never_makes_a_camera_unusable() {
        // preferred_formats is a ranking, not an allowlist. A BRIO reporting
        // only a raw mode is odd, but refusing to record from it would be worse
        // than recording what it offers.
        let brio = match_profile("Logitech BRIO", Some("046d"), Some("085e")).unwrap();
        let raw_only: Vec<VideoMode> = brio_like_modes()
            .into_iter()
            .filter(|m| !m.compressed)
            .collect();
        let picked = select_mode(&raw_only, 1920, 1080, 5, brio.preferred_formats).unwrap();
        assert_eq!(picked.format, "yuyv422");
    }

    #[test]
    fn generic_camera_may_use_raw_when_that_is_all_it_has() {
        let raw_only = vec![VideoMode {
            format: "yuyv422".into(),
            compressed: false,
            width: 640,
            height: 480,
            min_fps: 5.0,
            max_fps: 30.0,
        }];
        assert!(select_mode(&raw_only, 640, 480, 30, GENERIC_FORMAT_PREFERENCE).is_some());
    }

    #[test]
    fn vendor_product_match_beats_a_broader_vendor_entry() {
        // "Logitech webcam" also matches vid 046d; the BRIO entry must win.
        let p = match_profile("Some Camera", Some("046d"), Some("085e")).unwrap();
        assert_eq!(p.label, "Logitech BRIO");
        let generic = match_profile("Some Camera", Some("046d"), Some("9999")).unwrap();
        assert_eq!(generic.label, "Logitech webcam");
    }

    #[test]
    fn parses_avfoundation_devices_and_indices() {
        let d = parse_avfoundation_devices(AVF_DEVICES);
        assert_eq!(d.len(), 3);
        assert_eq!(d[1].name, "Logitech BRIO");
        assert_eq!(d[1].token, "1");
        // Indices move between runs, so the name is what we store.
        assert_eq!(d[1].fingerprint, "Logitech BRIO");
        assert_eq!(d[2].kind, DeviceKind::Audio);
    }

    #[test]
    fn parses_avfoundation_supported_modes() {
        let m = parse_avfoundation_modes(AVF_MODES);
        assert_eq!(m.len(), 3);
        assert_eq!((m[2].width, m[2].height, m[2].max_fps), (1920, 1080, 30.0));
    }

    #[test]
    fn standard_rates_are_clamped_to_what_was_advertised() {
        assert_eq!(standard_fps_within(5.0, 30.0), vec![5, 10, 15, 20, 24, 25, 30]);
        assert_eq!(standard_fps_within(5.0, 5.0), vec![5]);
    }

    #[test]
    fn resolutions_are_offered_largest_first() {
        let m = parse_dshow_options(DSHOW_OPTIONS);
        let r = resolution_options(&m);
        assert_eq!((r[0].0, r[0].1), (1920, 1080));
        assert_eq!((r[2].0, r[2].1), (640, 480));
    }

    #[test]
    fn recommends_1080p30_when_the_camera_can_do_it() {
        let m = parse_dshow_options(DSHOW_OPTIONS);
        assert_eq!(recommend_mode(&m, GENERIC_FORMAT_PREFERENCE), Some((1920, 1080, 30)));
    }

    #[test]
    fn recommends_the_best_available_on_a_limited_camera() {
        let m = vec![VideoMode {
            format: "yuyv422".into(),
            compressed: false,
            width: 640,
            height: 480,
            min_fps: 5.0,
            max_fps: 15.0,
        }];
        assert_eq!(recommend_mode(&m, GENERIC_FORMAT_PREFERENCE), Some((640, 480, 15)));
    }
}
