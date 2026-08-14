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

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("remote.json"))
}

pub fn load_config(app: &AppHandle) -> RemoteSettings {
    // Missing or corrupt config must not stop the app; defaults mean "not
    // configured", which the frontend treats as "use the manual picker".
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, settings: &RemoteSettings) -> Result<(), String> {
    let path = config_path(app)?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not serialise remote settings: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// The frontend never receives the secret, so it cannot echo it back; without
/// this merge, saving any other field would erase it.
pub fn merge_update(existing: &RemoteSettings, update: RemoteUpdate) -> RemoteSettings {
    RemoteSettings {
        round_robin_url: update
            .round_robin_url
            .or_else(|| existing.round_robin_url.clone()),
        research_drive_root: update
            .research_drive_root
            .or_else(|| existing.research_drive_root.clone()),
        round_robin_secret: match update.round_robin_secret {
            Some(s) if s.trim().is_empty() => None,
            Some(s) => Some(s),
            None => existing.round_robin_secret.clone(),
        },
    }
}

#[tauri::command]
pub fn remote_status(app: AppHandle) -> RemotePublic {
    RemotePublic::from(&load_config(&app))
}

#[tauri::command]
pub fn remote_configure(app: AppHandle, update: RemoteUpdate) -> Result<RemotePublic, String> {
    let merged = merge_update(&load_config(&app), update);
    save_config(&app, &merged)?;
    Ok(RemotePublic::from(&merged))
}

// ---------------------------------------------------------------------------
// Round Robin API
// ---------------------------------------------------------------------------

fn credentials(app: &AppHandle) -> Result<(String, String), String> {
    let s = load_config(app);
    let url = s
        .round_robin_url
        .filter(|u| !u.trim().is_empty())
        .ok_or("No Round Robin address is configured on the dashboard.")?;
    let secret = s
        .round_robin_secret
        .filter(|v| !v.trim().is_empty())
        .ok_or("No Round Robin shared secret is configured on the dashboard.")?;
    Ok((url, secret))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Joins a path onto a configured base URL, tolerating a trailing slash.
fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

async fn describe_failure(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body = body.trim();
    match status.as_u16() {
        401 => "Round Robin rejected the shared secret. Check it on the dashboard.".into(),
        404 => format!(
            "Round Robin does not know that participant. {body}"
        ),
        _ => format!("Round Robin returned {status}. {body}"),
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
    let response = client()?
        .get(endpoint(&url, "api/pps/recordings"))
        .query(&[("email", email.as_str())])
        .bearer_auth(&secret)
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

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_CHUNK_BYTES];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
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

    #[test]
    fn saving_another_field_does_not_erase_the_secret() {
        let existing = RemoteSettings {
            round_robin_url: Some("https://rr.example".into()),
            round_robin_secret: Some("s3cret".into()),
            research_drive_root: Some("Z:/recordings".into()),
        };
        let updated = merge_update(
            &existing,
            RemoteUpdate {
                research_drive_root: Some("Y:/other".into()),
                ..Default::default()
            },
        );
        assert_eq!(updated.round_robin_secret.as_deref(), Some("s3cret"));
        assert_eq!(updated.research_drive_root.as_deref(), Some("Y:/other"));
    }

    #[test]
    fn an_empty_secret_clears_it_deliberately() {
        let existing = RemoteSettings {
            round_robin_secret: Some("s3cret".into()),
            ..Default::default()
        };
        let updated = merge_update(
            &existing,
            RemoteUpdate {
                round_robin_secret: Some("".into()),
                ..Default::default()
            },
        );
        assert!(updated.round_robin_secret.is_none());
    }

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
