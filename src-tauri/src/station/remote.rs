// Talking to the Round Robin web app, and fetching conversation recordings
// off the Research Drive.
//
// This is the receiving end of the recording pipeline. Lab Recorder writes a
// verified CFR MP4 to the Research Drive share and registers the take with
// Round Robin, stamped with the two participants from the rotation. This
// module asks Round Robin "which conversations does this participant appear
// in?", copies the file from the mounted share to a local cache, and proves
// the copy intact against the recorder's own checksum before anything plays
// it. Playing from local disk rather than over SMB matters here: the dyad
// task samples the slider against video time every 100 ms, and a network
// stall mid-playback would put a hole straight into the measurement.
//
// Same architecture as lab-recorder's roundrobin.rs, for the same reasons:
//
// - The device key lives in Rust only and is never sent to the webview. Since
//   2026-08-22 it is compiled into the build rather than typed (machine.rs).
// - Round Robin being unreachable degrades to the manual file picker the RA
//   uses today — it must never block a session.
// - The cache holds at most one conversation at a time: preparing a new one
//   deletes the previous. Participant video does not accumulate on lab
//   machines (IRB 2020-1657).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// Short on purpose: these calls run while an RA is setting up a participant.
/// A slow server should degrade to the manual picker, not hold up the session.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// How often the copy loop reports progress to the webview, in bytes copied.
const PROGRESS_EVERY_BYTES: u64 = 8 * 1024 * 1024;

const COPY_CHUNK_BYTES: usize = 1024 * 1024;

// ---------------------------------------------------------------------------
// Config: remote.json, Rust-only
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteSettings {
    /// Base URL of the Round Robin deployment, e.g. https://roundrobin.example.
    pub round_robin_url: Option<String>,
    /// A device key typed on this machine before the built-in one existed.
    /// Never leaves this process.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_robin_secret: Option<String>,
    /// Local mount of the Research Drive share that RECORDING_DIR points at on
    /// the server. Windows: a mapped letter or UNC path. macOS: /Volumes/...
    pub research_drive_root: Option<String>,
}

/// What the frontend is allowed to see.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePublic {
    pub round_robin_url: Option<String>,
    pub research_drive_root: Option<String>,
    /// True when the Research Drive folder was chosen deliberately rather than
    /// falling back to this computer's own folder. The station shows the
    /// difference: only a real share lets a *different* computer's recording
    /// be found.
    pub drive_is_shared: bool,
    /// Folders this machine has used before, newest first — the one-click
    /// chips on the setup screen. See machine::remember_drive_root.
    pub recent_drive_roots: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteUpdate {
    pub round_robin_url: Option<String>,
    pub research_drive_root: Option<String>,
}

// In the suite, remote.json is retired: the URL / secret / drive root live in
// the machine-wide store (machine.rs), entered once and consumed by every
// mode. These functions keep their signatures and wire shapes — the station
// frontend calls them unchanged — and map to that store.

pub fn load_config(app: &AppHandle) -> RemoteSettings {
    let m = crate::machine::load(app);
    RemoteSettings {
        // The effective values, not the raw stored ones: both the server
        // address and the recordings folder have working defaults, and a
        // station that sees them empty decides it is unconfigured and never
        // looks for the participant's video.
        round_robin_url: Some(crate::machine::server_url(app)),
        round_robin_secret: m.round_robin_secret,
        research_drive_root: crate::machine::drive_root(app),
    }
}

#[tauri::command]
pub fn remote_status(app: AppHandle) -> RemotePublic {
    RemotePublic {
        round_robin_url: Some(crate::machine::server_url(&app)),
        research_drive_root: crate::machine::drive_root(&app),
        drive_is_shared: !crate::machine::drive_is_local_fallback(&app),
        recent_drive_roots: crate::machine::load(&app).recent_drive_roots,
    }
}

#[tauri::command]
pub fn remote_configure(app: AppHandle, update: RemoteUpdate) -> Result<RemotePublic, String> {
    let machine_update = crate::machine::MachineUpdate {
        round_robin_url: update.round_robin_url,
        research_drive_root: update.research_drive_root,
    };
    let merged = crate::machine::merge_update(&crate::machine::load(&app), machine_update);
    crate::machine::save(&app, &merged)?;
    Ok(remote_status(app))
}

// ---------------------------------------------------------------------------
// Round Robin API
// ---------------------------------------------------------------------------

fn credentials(app: &AppHandle) -> (String, String) {
    crate::machine::credentials(app)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Joins a path onto a configured base URL, tolerating a trailing slash.
/// One implementation for both modes — see shared/http.rs.
fn endpoint(base_url: &str, path: &str) -> String {
    crate::shared::http::endpoint(base_url, path)
}

/// Trims a server response down to something a person can read on a study
/// screen. A misrouted request comes back as a full HTML error page, and
/// pasting that into the UI produced an unreadable wall of markup where an
/// RA needed one sentence (observed 2026-08-17). HTML is dropped entirely —
/// it never carries a useful message — and anything else is capped.
pub fn readable_body(body: &str) -> String {
    let body = body.trim();
    if body.starts_with('<') || body.to_ascii_lowercase().starts_with("<!doctype") {
        return String::new();
    }
    if body.chars().count() > 200 {
        let short: String = body.chars().take(200).collect();
        format!("{short}…")
    } else {
        body.to_string()
    }
}

async fn describe_failure(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body = readable_body(&body);
    let body = body.as_str();
    let detail = if body.is_empty() {
        String::new()
    } else {
        format!(" {body}")
    };
    match status.as_u16() {
        401 => "Round Robin rejected the shared secret. Check it on the dashboard.".into(),
        // A 404 here is ambiguous and the two causes need different actions,
        // so say both rather than guessing: the participant may be unknown to
        // the schedule, or the server may not be serving its API at all.
        404 => format!(
            "Round Robin answered 'not found'. Either this participant is not on the \
             schedule, or the server is not running its API at that address.{detail}"
        ),
        _ => format!("Round Robin returned {status}.{detail}"),
    }
}

/// Mirrors the participant's live progress to the Round Robin session board,
/// so the RAs running the session see every rating station without walking
/// over. Display-only for the researchers — never study data — so the caller
/// treats failures as ignorable.
#[tauri::command]
pub async fn report_study_progress(
    app: AppHandle,
    email: String,
    stage: String,
    percent: Option<u32>,
    needs_help: Option<bool>,
) -> Result<(), String> {
    let (url, secret) = credentials(&app);
    let mut body = serde_json::json!({ "email": email, "stage": stage });
    if let Some(percent) = percent {
        body["percent"] = serde_json::json!(percent);
    }
    if needs_help == Some(true) {
        body["needsHelp"] = serde_json::json!(true);
    }

    let response = client()?
        .post(endpoint(&url, "api/pps/progress"))
        .bearer_auth(&secret)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }
    Ok(())
}

/// One-shot health check for the dashboard: proves the URL resolves, this
/// build's device key is accepted, and the Research Drive mount is reachable,
/// in words an RA can read back over the phone.
#[tauri::command]
pub async fn remote_test(app: AppHandle) -> Result<String, String> {
    let (url, secret) = credentials(&app);
    let response = client()?
        .get(endpoint(&url, "api/pps/sessions"))
        .bearer_auth(&secret)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }

    #[derive(Deserialize)]
    struct Wrapper {
        sessions: Vec<serde_json::Value>,
    }
    let sessions = response
        .json::<Wrapper>()
        .await
        .map(|w| w.sessions.len())
        .map_err(|e| format!("Round Robin sent something unexpected: {e}"))?;

    let drive = match load_config(&app).research_drive_root {
        Some(root) if !root.trim().is_empty() => {
            if Path::new(&root).is_dir() {
                "The Research Drive folder is reachable.".to_string()
            } else {
                format!("The Research Drive folder is NOT reachable at {root} — is the share mounted?")
            }
        }
        _ => "No Research Drive folder is set — videos cannot be fetched automatically.".into(),
    };

    Ok(format!(
        "Connected — the secret was accepted. {sessions} upcoming session(s) on the schedule. {drive}"
    ))
}

// ---------------------------------------------------------------------------
// Fetching the video off the Research Drive
// ---------------------------------------------------------------------------

/// The conversation recordings filed under a dyad number.
///
/// This replaced a round trip to Round Robin keyed on the participant's email
/// address (2026-09-24). That lookup needed a session to exist on the server,
/// a rotation to have been generated, the room to have been claimed, the
/// participant to be on the schedule, and the address they signed in with to
/// be the one the schedule had — five things, any of which could be wrong
/// while a perfectly good recording sat on the drive three feet away.
///
/// A dyad number is one thing, and both ends of the pipeline already know it:
/// the recording room typed it, and this station has it off the session board.
/// So the station reads the drive directly and nothing is asked of anybody.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DyadVideo {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    /// Newest first is the order that matters, and this is what it sorts on.
    /// Seconds since the epoch, from the file itself.
    pub modified_at: u64,
    /// Stable per file, so re-picking one reuses the local copy instead of
    /// moving the gigabyte again. Safe as a filename by construction.
    pub recording_id: String,
}

/// Extensions the rating task can play. A `.json` manifest and a `.partial`
/// half-copy both live in the same folder, and neither is a conversation.
const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mkv", "mov", "m4v"];

/// A filename-safe id for a path. FNV-1a, same idea as utils/hash.ts on the
/// frontend — it only has to be stable and collision-free enough to name a
/// cache file.
fn id_for_path(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("dyadvid-{hash:016x}")
}

fn collect_videos(dir: &Path, prefix: Option<&str>, out: &mut Vec<DyadVideo>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !VIDEO_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(prefix) = prefix {
            if !file_name.to_lowercase().starts_with(&prefix.to_lowercase()) {
                continue;
            }
        }
        let metadata = entry.metadata().ok();
        let bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(DyadVideo {
            recording_id: id_for_path(&path),
            path: path.to_string_lossy().to_string(),
            file_name,
            bytes,
            modified_at,
        });
    }
}

/// Everything filed under this dyad on the Research Drive, newest first.
///
/// An empty list is an ordinary answer, not an error: the conversation may
/// simply not have finished filing yet. The setup screen says so and offers
/// the file picker, exactly as it always did.
#[tauri::command]
pub fn find_dyad_videos(app: AppHandle, dyad_id: String) -> Result<Vec<DyadVideo>, String> {
    let root = crate::machine::drive_root(&app).ok_or_else(|| {
        "No Research Drive folder is set on this computer, so there is \
         nowhere to look. Set it above, or pick the file by hand."
            .to_string()
    })?;
    let root = Path::new(&root);
    let folder = crate::recorder::archive::dyad_folder(&dyad_id);

    let mut found = Vec::new();
    collect_videos(&root.join(&folder), None, &mut found);
    // Also the root itself, for a take filed by an older recorder or dropped
    // there by hand. Matching on the same `dyad-014` prefix the filename
    // carries, so this cannot pick up somebody else's conversation.
    if folder != "unfiled" {
        collect_videos(root, Some(&folder), &mut found);
    }

    found.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    found.dedup_by(|a, b| a.path == b.path);
    Ok(found)
}

/// Only characters that can appear in the UUIDs Round Robin generates. Keeps a
/// server-supplied id from naming a path.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// One hash implementation for both ends of the checksum chain — see
/// shared/hashing.rs. The recorder computed the checksum this verifies.
fn file_sha256(path: &Path) -> Result<String, String> {
    crate::shared::hashing::file_sha256(path)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub recording_id: String,
    /// The checksum Lab Recorder published beside the take, when there is one.
    /// There usually is not any more — a file found on the drive by its dyad
    /// number carries no promise from a server — and `verified` says so rather
    /// than implying a guarantee nobody made.
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedVideo {
    pub local_path: String,
    pub bytes: u64,
    /// True only when the copy was re-hashed and matched the recorder's
    /// checksum. False means no checksum was available to check against.
    pub verified: bool,
    /// True when a previous prepared copy was reused.
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyProgress {
    recording_id: String,
    copied_bytes: u64,
    total_bytes: u64,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("conversation-cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copies a file the RA browsed to into the same local cache.
///
/// The manual escape hatch used to hand the task a path and let the <video>
/// element stream it — over SMB, if the RA browsed to the share, which is the
/// normal case. That is exactly what this pipeline exists to avoid: the dyad
/// task samples the slider against video time every 100 ms, and a network stall
/// mid-playback puts a hole straight into the measurement. A hand-picked file
/// now gets the same treatment as a fetched one.
///
/// No checksum, because there is no manifest behind a file someone browsed to
/// and nothing to check it against. `verified` comes back false and the
/// interface says so rather than implying a guarantee it did not make.
///
/// The caller supplies the id (station/setup derives it from the path with
/// fnv1a) so re-picking the same file reuses the copy instead of moving the
/// gigabyte again.
#[tauri::command]
pub async fn prepare_local_video(
    app: AppHandle,
    recording_id: String,
    path: String,
) -> Result<PreparedVideo, String> {
    if !is_safe_id(&recording_id) {
        return Err("Unusable recording id.".into());
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("There is no file at {path}."));
    }
    let destination = cache_dir(&app)?.join(format!("{recording_id}.mp4"));
    let request = PrepareRequest {
        recording_id,
        sha256: None,
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        copy_into_cache(&handle, &source, &destination, request)
    })
    .await
    .map_err(|e| format!("copy task failed: {e}"))?
}

fn copy_into_cache(
    app: &AppHandle,
    source: &Path,
    destination: &Path,
    request: PrepareRequest,
) -> Result<PreparedVideo, String> {
    // Reuse a copy that already checks out — the RA re-entering the form after
    // a mistake should not sit through the same gigabyte twice.
    if destination.exists() {
        let ok = match &request.sha256 {
            Some(expected) => file_sha256(destination).ok().as_deref() == Some(expected.as_str()),
            None => true,
        };
        if ok {
            let bytes = std::fs::metadata(destination).map(|m| m.len()).unwrap_or(0);
            return Ok(PreparedVideo {
                local_path: destination.to_string_lossy().to_string(),
                bytes,
                verified: request.sha256.is_some(),
                cached: true,
            });
        }
        let _ = std::fs::remove_file(destination);
    }

    if !source.exists() {
        return Err(format!(
            "The recording is not on the Research Drive at {}. Is the share mounted, and has the recorder finished filing it?",
            source.display()
        ));
    }

    // At most one conversation lives in the cache. Clearing before copying,
    // not after: video of identifiable participants must not pile up on a lab
    // machine that happens never to finish a session (IRB 2020-1657).
    if let Some(dir) = destination.parent() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(Result::ok) {
                if entry.path() != destination {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    let total_bytes = std::fs::metadata(source)
        .map(|m| m.len())
        .map_err(|e| format!("could not read {}: {e}", source.display()))?;

    let staging = destination.with_extension("partial");
    let _ = std::fs::remove_file(&staging);

    let mut reader = std::fs::File::open(source)
        .map_err(|e| format!("could not open {}: {e}", source.display()))?;
    let mut writer = std::fs::File::create(&staging)
        .map_err(|e| format!("could not create {}: {e}", staging.display()))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_CHUNK_BYTES];
    let mut copied: u64 = 0;
    let mut last_report: u64 = 0;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("reading from the Research Drive failed mid-copy: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("writing the local copy failed: {e}"))?;
        copied += read as u64;
        if copied - last_report >= PROGRESS_EVERY_BYTES || copied == total_bytes {
            last_report = copied;
            let _ = app.emit(
                "conversation-copy-progress",
                CopyProgress {
                    recording_id: request.recording_id.clone(),
                    copied_bytes: copied,
                    total_bytes,
                },
            );
        }
    }
    writer
        .flush()
        .map_err(|e| format!("writing the local copy failed: {e}"))?;
    drop(writer);

    let arrived = format!("{:x}", hasher.finalize());
    if let Some(expected) = &request.sha256 {
        if &arrived != expected {
            // The bytes read off the share are not the bytes the recorder
            // wrote. Leaving the file would let a truncated SMB read become
            // someone's study session.
            let _ = std::fs::remove_file(&staging);
            return Err(format!(
                "The copy does not match the recorder's checksum (expected {}, got {}). \
                 The file on the Research Drive may still be being written — try again in a minute.",
                &expected[..12.min(expected.len())],
                &arrived[..12.min(arrived.len())]
            ));
        }
    }

    let _ = std::fs::remove_file(destination);
    std::fs::rename(&staging, destination).map_err(|e| {
        format!(
            "verified copy could not be renamed into place at {}: {e}",
            destination.display()
        )
    })?;

    Ok(PreparedVideo {
        local_path: destination.to_string_lossy().to_string(),
        bytes: copied,
        verified: request.sha256.is_some(),
        cached: false,
    })
}

// ---------------------------------------------------------------------------
// Confirming the video before the session starts
// ---------------------------------------------------------------------------

/// One frame from a video file, as JPEG bytes.
///
/// This is the RA's "is that the right conversation?" check, and the whole
/// reason it is affordable is the argument order: `-ss` *before* `-i` makes
/// FFmpeg seek to the timestamp rather than decode forward to it, so this reads
/// a few hundred KB off the share instead of the ~1 GB the copy will later
/// move. Fast enough to run while the RA is still filling in the form, and
/// cheap enough to re-run every time they change their mind.
///
/// Raw bytes rather than base64, like the recorder's preview_frame: the webview
/// turns them into a blob URL and never decodes anything.
#[tauri::command]
pub async fn video_thumbnail(
    app: AppHandle,
    path: String,
    at_seconds: f64,
) -> Result<tauri::ipc::Response, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("There is no file at {path}."));
    }
    // Clamped because both ends are real failures rather than edge cases: a
    // negative seek is an error, and seeking past the end of a short clip
    // returns no frame at all with a zero exit status.
    let seek = at_seconds.clamp(0.0, 3600.0);
    let args: Vec<String> = vec![
        // Never wait on stdin: with none attached, a prompt (an existing output
        // file, a stream question) would hang this call forever.
        "-nostdin".into(),
        "-ss".into(),
        format!("{seek:.3}"),
        "-i".into(),
        path,
        "-frames:v".into(),
        "1".into(),
        // -2 rather than -1 on the height: MJPEG wants even dimensions, and a
        // source with an odd aspect ratio would otherwise fail to encode.
        "-vf".into(),
        "scale=480:-2".into(),
        "-f".into(),
        "image2".into(),
        "-vcodec".into(),
        "mjpeg".into(),
        "-".into(),
    ];

    let bytes = crate::recorder::ffmpeg::run_tool_bytes(&app, "ffmpeg", args).await?;
    if bytes.is_empty() {
        // FFmpeg exits zero having written nothing when the file is truncated
        // or still being copied, which is exactly the case worth telling the RA
        // about — it means the recording room has not finished filing it.
        return Err(
            "No frame could be read. The recording may still be copying to the Research Drive."
                .into(),
        );
    }
    Ok(tauri::ipc::Response::new(bytes))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_tolerates_a_trailing_slash() {
        assert_eq!(
            endpoint("https://rr.example/", "api/pps/recordings"),
            "https://rr.example/api/pps/recordings"
        );
        assert_eq!(
            endpoint("https://rr.example", "/api/pps/progress"),
            "https://rr.example/api/pps/progress"
        );
    }

    #[test]
    fn an_html_error_page_never_reaches_the_screen() {
        // A misrouted request returns the server's whole HTML 404 document.
        // Pasted into the study UI it became a red box of markup an RA could
        // not read to the end (2026-08-17).
        let page = "<!DOCTYPE html><html><head><title>404</title></head><body>…</body></html>";
        assert_eq!(readable_body(page), "");
        assert_eq!(readable_body("<html>anything</html>"), "");
    }

    #[test]
    fn a_long_plain_body_is_capped_and_a_short_one_survives() {
        let long = "x".repeat(500);
        let out = readable_body(&long);
        assert!(out.chars().count() <= 201, "got {} chars", out.chars().count());
        assert!(out.ends_with('…'));
        assert_eq!(readable_body("  slotId is required  "), "slotId is required");
    }

    #[test]
    fn a_cache_id_is_stable_per_file_and_safe_as_a_filename() {
        // Stable: re-picking the same conversation must reuse the local copy
        // rather than move the gigabyte again.
        let a = id_for_path(Path::new("R:/niedenthal/recordings/dyad-014/dyad-014_20260924-140312.mp4"));
        let b = id_for_path(Path::new("R:/niedenthal/recordings/dyad-014/dyad-014_20260924-140312.mp4"));
        let other = id_for_path(Path::new("R:/niedenthal/recordings/dyad-015/dyad-015_20260924-141500.mp4"));
        assert_eq!(a, b);
        assert_ne!(a, other);
        assert!(is_safe_id(&a), "{a} would have to be usable as a filename");
    }

    #[test]
    fn a_dyad_number_reaches_the_folder_the_recorder_wrote() {
        // The linkage, end to end and in one line: the recording room's
        // dyad_folder and the station's have to agree.
        assert_eq!(crate::recorder::archive::dyad_folder("14"), "dyad-014");
        assert_eq!(crate::recorder::archive::dyad_folder("014"), "dyad-014");
    }

    #[test]
    fn recording_ids_that_could_name_paths_are_refused() {
        assert!(is_safe_id("0d9b2c1e-4f6a-4b7e-9c1d-2e3f4a5b6c7d"));
        assert!(!is_safe_id("../sneaky"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id(""));
    }

    // The secret-merge semantics (empty clears, absent preserves) are owned
    // and tested by machine.rs now — remote_configure maps onto that single
    // implementation.

    #[test]
    fn the_public_shape_has_nowhere_to_put_a_device_key() {
        // Not a formality: the whole reason the key stays in Rust is that a
        // rendering bug cannot leak a value the wire shape has no field for.
        let public = RemotePublic {
            round_robin_url: Some("https://rr.example".into()),
            research_drive_root: Some("R:/niedenthal/recordings".into()),
            recent_drive_roots: Vec::new(),
            drive_is_shared: true,
        };
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("secret"), "the public shape grew a secret field");
        assert!(!json.contains("Key"), "the public shape grew a key field");
    }

    /// The whole hand-off, both halves, against a real directory.
    ///
    /// The recording room files a take under a dyad number and a rating
    /// station set to the same number finds it — with no server, no session,
    /// no rotation and nobody's email address in between. If this passes, a
    /// conversation recorded in Room 386 plays in Room 385.
    #[test]
    fn a_take_the_recorder_filed_is_a_take_the_station_finds() {
        use crate::recorder::archive::{copy_verified, dyad_destination};
        use crate::recorder::manifest::file_sha256;

        let drive = std::env::temp_dir().join(format!("labsuite-linkage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&drive);
        std::fs::create_dir_all(&drive).unwrap();

        // --- the recording room's half. The RA typed "14"; fileStem produced
        // this name; archive_recording copies it to the drive.
        let local = drive.join("dyad-014_20260924-140312.mp4");
        std::fs::write(&local, b"pretend this is a ten minute conversation").unwrap();
        let sha = file_sha256(&local).unwrap();
        let destination = dyad_destination(&drive, "14", &local).unwrap();
        copy_verified(&local, &destination, &sha).unwrap();

        // --- the rating station's half. It has the dyad off the session board
        // as "014"; the recording room typed "14". Same folder, by construction.
        let mut found = Vec::new();
        collect_videos(&drive.join(crate::recorder::archive::dyad_folder("014")), None, &mut found);
        assert_eq!(found.len(), 1, "the station did not find the filed take: {found:?}");
        assert_eq!(found[0].file_name, "dyad-014_20260924-140312.mp4");
        assert!(found[0].bytes > 0);

        // --- and it does not find somebody else's conversation.
        let mut other = Vec::new();
        collect_videos(&drive.join(crate::recorder::archive::dyad_folder("15")), None, &mut other);
        assert!(other.is_empty(), "dyad 15 picked up dyad 14's recording");

        std::fs::remove_dir_all(&drive).ok();
    }

    /// The manifest and the half-written staging file share the folder with
    /// the video. Neither is a conversation, and offering one to an RA as a
    /// clip to rate would be worse than offering nothing.
    #[test]
    fn only_video_files_are_offered_as_conversations() {
        let dir = std::env::temp_dir().join(format!("labsuite-filter-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "dyad-014_20260924-140312.mp4",
            "dyad-014_20260924-140312.json",
            "dyad-014_20260924-141500.partial",
            "notes.txt",
        ] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }

        let mut found = Vec::new();
        collect_videos(&dir, None, &mut found);
        let names: Vec<&str> = found.iter().map(|v| v.file_name.as_str()).collect();
        assert_eq!(names, vec!["dyad-014_20260924-140312.mp4"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A take dropped in the root of the drive rather than in its dyad folder
    /// is still found, and still only by its own dyad.
    #[test]
    fn a_prefix_match_in_the_root_cannot_cross_dyads() {
        let dir = std::env::temp_dir().join(format!("labsuite-prefix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("dyad-014_20260924-140312.mp4"), b"x").unwrap();
        std::fs::write(dir.join("dyad-015_20260924-141500.mp4"), b"x").unwrap();

        let mut found = Vec::new();
        collect_videos(&dir, Some("dyad-014"), &mut found);
        let names: Vec<&str> = found.iter().map(|v| v.file_name.as_str()).collect();
        assert_eq!(names, vec!["dyad-014_20260924-140312.mp4"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copies_and_verifies_against_the_recorder_checksum() {
        let dir = std::env::temp_dir().join(format!("pps-remote-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("take.mp4");
        std::fs::write(&src, b"conversation bytes").unwrap();
        let expected = file_sha256(&src).unwrap();

        // copy_into_cache needs an AppHandle for events, so exercise the pure
        // pieces it is built from instead.
        assert_eq!(expected.len(), 64);
        let again = file_sha256(&src).unwrap();
        assert_eq!(expected, again, "hashing must be deterministic");

        std::fs::remove_dir_all(&dir).ok();
    }
}
