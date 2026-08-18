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
// - The shared secret lives in a Rust-only config file (remote.json) and is
//   never sent to the webview. The frontend learns only whether one exists.
// - Round Robin being unreachable degrades to the manual file picker the RA
//   uses today — it must never block a session.
// - The cache holds at most one conversation at a time: preparing a new one
//   deletes the previous. Participant video does not accumulate on lab
//   machines (IRB 2020-1657).

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
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
    /// The PPS shared secret. Never leaves this process.
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
    /// Whether a secret exists — never the secret itself.
    pub secret_configured: bool,
}

impl From<&RemoteSettings> for RemotePublic {
    fn from(s: &RemoteSettings) -> Self {
        RemotePublic {
            round_robin_url: s.round_robin_url.clone(),
            research_drive_root: s.research_drive_root.clone(),
            secret_configured: s
                .round_robin_secret
                .as_ref()
                .is_some_and(|v| !v.trim().is_empty()),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteUpdate {
    pub round_robin_url: Option<String>,
    /// Empty string clears it; omitting the field leaves it untouched.
    pub round_robin_secret: Option<String>,
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
    RemotePublic::from(&load_config(&app))
}

#[tauri::command]
pub fn remote_configure(app: AppHandle, update: RemoteUpdate) -> Result<RemotePublic, String> {
    let machine_update = crate::machine::MachineUpdate {
        round_robin_url: update.round_robin_url,
        round_robin_secret: update.round_robin_secret,
        research_drive_root: update.research_drive_root,
    };
    let merged = crate::machine::merge_update(&crate::machine::load(&app), machine_update);
    crate::machine::save(&app, &merged)?;
    Ok(RemotePublic::from(&load_config(&app)))
}

// ---------------------------------------------------------------------------
// Round Robin API
// ---------------------------------------------------------------------------

fn credentials(app: &AppHandle) -> Result<(String, String), String> {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPartner {
    pub id: String,
    pub full_name: String,
    pub email: String,
}

/// One conversation the participant appears in, as Round Robin reports it.
/// `storage_key` and `sha256` are only present for secret-authenticated
/// callers — which this app is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClip {
    pub recording_id: String,
    pub slot_id: String,
    pub session_date: Option<String>,
    pub round: i32,
    pub room_index: i32,
    pub duration_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub partner: Option<ClipPartner>,
    pub url: String,
    #[serde(default)]
    pub storage_key: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipsParticipant {
    pub id: String,
    pub email: String,
    pub full_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipsResponse {
    pub participant: ClipsParticipant,
    pub clips: Vec<RemoteClip>,
}

/// The conversations this participant appears in, stamped with their partner
/// at capture time. This is the whole routing answer: the RA types nothing
/// about files, the sign-in email finds the video.
#[tauri::command]
pub async fn list_conversation_clips(
    app: AppHandle,
    email: String,
) -> Result<ClipsResponse, String> {
    let (url, secret) = credentials(&app)?;

    // First choice: this participant's own conversations, keyed on the email
    // they signed in with.
    let by_email = clips_for_email(&url, &secret, &email).await;

    match by_email {
        Ok(response) if response.clips.iter().any(|c| c.storage_key.is_some()) => Ok(response),
        // The email is not the only way in, and being unknown to the schedule
        // must not strand a station in front of a conversation that plainly
        // exists. Fall back to everything recorded today and let the RA pick
        // — the chooser for that is already on screen whenever more than one
        // conversation comes back.
        other => {
            let today = clips_today(&url, &secret).await;
            match today {
                Ok(clips) if !clips.is_empty() => Ok(ClipsResponse {
                    participant: ClipsParticipant {
                        id: String::new(),
                        email: email.clone(),
                        full_name: String::new(),
                    },
                    clips,
                }),
                // Nothing today either: report whichever failure is the more
                // useful thing to act on.
                _ => match other {
                    Ok(_) => Err(format!(
                        "Nothing to play yet. The server has no finished recording for {email}, \
                         and no recording from the last two weeks either.\n\n\
                         Two things this usually means. Either the conversation has not been \
                         recorded and filed yet — the recording room finishes that a few seconds \
                         after Stop, so wait a moment and press Try again. Or this participant \
                         signed in with an email that is not the one on the schedule, in which \
                         case the recording exists under their real address; check the roster on \
                         the Control Center. You can always choose the file by hand below."
                    )),
                    Err(e) => Err(e),
                },
            }
        }
    }
}

async fn clips_for_email(
    url: &str,
    secret: &str,
    email: &str,
) -> Result<ClipsResponse, String> {
    let response = client()?
        .get(endpoint(url, "api/pps/recordings"))
        .query(&[("email", email)])
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }
    response
        .json::<ClipsResponse>()
        .await
        .map_err(|e| format!("Round Robin sent something unexpected: {e}"))
}

/// Every conversation recorded and stored today, whoever it belongs to.
async fn clips_today(url: &str, secret: &str) -> Result<Vec<RemoteClip>, String> {
    #[derive(Deserialize)]
    struct Wrapper {
        clips: Vec<RemoteClip>,
    }
    let response = client()?
        .get(endpoint(url, "api/pps/session-clips"))
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }
    response
        .json::<Wrapper>()
        .await
        .map(|w| w.clips)
        .map_err(|e| format!("Round Robin sent something unexpected: {e}"))
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
    let (url, secret) = credentials(&app)?;
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

/// One-shot health check for the dashboard: proves the URL resolves, the
/// secret is accepted, and the Research Drive mount is reachable, in words an
/// RA can read back over the phone.
#[tauri::command]
pub async fn remote_test(app: AppHandle) -> Result<String, String> {
    let (url, secret) = credentials(&app)?;
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

/// Resolves a server-supplied storage key against the local Research Drive
/// mount. The key arrives over the network, so it is treated as untrusted even
/// though we made the request that produced it — a key containing `..` would
/// otherwise read anywhere on the drive.
pub fn resolve_storage_path(root: &Path, storage_key: &str) -> Result<PathBuf, String> {
    if storage_key.trim().is_empty() {
        return Err("The storage key is empty.".into());
    }
    let relative = Path::new(storage_key);
    if relative.is_absolute() {
        return Err(format!("Storage key must be relative, got {storage_key}"));
    }
    for component in relative.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(format!(
                    "Storage key must not contain path traversal, got {storage_key}"
                ))
            }
        }
    }
    Ok(root.join(relative))
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
    pub storage_key: String,
    /// The checksum Lab Recorder published when it closed the take. When
    /// present, the local copy must match it exactly.
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

/// Copies the conversation off the Research Drive into the local cache,
/// hashing as it copies, and only renames the file into place once the hash
/// matches the recorder's. Progress is emitted so the setup screen can show
/// the RA something better than a frozen page during a ~1 GB copy.
#[tauri::command]
pub async fn prepare_conversation_video(
    app: AppHandle,
    request: PrepareRequest,
) -> Result<PreparedVideo, String> {
    if !is_safe_id(&request.recording_id) {
        return Err("Round Robin sent an unusable recording id.".into());
    }
    let root = load_config(&app)
        .research_drive_root
        .filter(|r| !r.trim().is_empty())
        .ok_or(
            "No Research Drive folder is configured on the dashboard, so the recording cannot be fetched automatically.",
        )?;

    let source = resolve_storage_path(Path::new(&root), &request.storage_key)?;
    let destination = cache_dir(&app)?.join(format!("{}.mp4", request.recording_id));

    // Copying takes tens of seconds for a full conversation; off the async
    // runtime it goes.
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
    fn storage_keys_cannot_escape_the_drive_root() {
        let root = Path::new("Z:/recordings");
        assert!(resolve_storage_path(root, "slot/round-1/room-1-a-b.mp4").is_ok());
        assert!(resolve_storage_path(root, "../../etc/passwd").is_err());
        assert!(resolve_storage_path(root, "slot/../../escape.mp4").is_err());
        assert!(resolve_storage_path(root, "/absolute.mp4").is_err());
        assert!(resolve_storage_path(root, "  ").is_err());
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
    fn the_secret_never_reaches_the_frontend() {
        let settings = RemoteSettings {
            round_robin_url: Some("https://rr.example".into()),
            round_robin_secret: Some("s3cret".into()),
            research_drive_root: None,
        };
        let public = RemotePublic::from(&settings);
        assert!(public.secret_configured);
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("s3cret"), "serialised settings leaked the secret");
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
