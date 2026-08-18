// Registering a recording with Round Robin.
//
// The file itself never travels over HTTP. It is written to the same Research
// Drive share that RECORDING_DIR points at on the server, so Round Robin's
// existing playback route serves it with no changes — and the app sidesteps the
// 50 MB LimitRequestBody on the nickel Apache config, which a 900 MB take would
// hit immediately.
//
// What travels is a row: open a recording before the take so Round Robin stamps
// the dyad from the rotation at capture time, then close it afterwards with the
// integrity numbers.
//
// Round Robin is never allowed to block a recording. If the server is
// unreachable the take proceeds regardless and the registration is queued; a
// lab session must not fail because of a network hiccup, and a conversation
// between two people who have just met cannot be run again.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Short on purpose. This runs while an RA is standing in a room waiting to
/// press record; a slow server should degrade to "unregistered" quickly rather
/// than hold up the session.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub slot_id: String,
    pub date: String,
    pub time: Option<String>,
    pub room_count: i32,
    pub current_round: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRecording {
    pub id: String,
    pub storage_key: String,
    pub round: i32,
    pub room_index: i32,
    pub participant_a: Option<String>,
    pub participant_b: Option<String>,
    /// True when the rotation has no pair in this room for this round — the
    /// take is still recorded, but it will not route to anyone's rating station.
    #[serde(default)]
    pub unassigned: bool,
}

/// The integrity numbers Round Robin stores alongside the row, so the Control
/// Center can show which takes are trustworthy without opening them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosePayload {
    pub duration_ms: u64,
    pub capture_fps: u32,
    pub frames_dropped: u64,
    pub frames_duplicated: u64,
    pub sha256: String,
    pub profile_hash: String,
    pub recorder_version: String,
    pub cfr: bool,
    /// Size of the verified MP4. Round Robin needs it told when it runs on a
    /// host that cannot see the Research Drive share (DoIT shared hosting) —
    /// there the sha256 in this payload is what marks the take stored, and
    /// this is the size it records. Defaulted so queue entries written before
    /// the field existed still deserialize.
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRegistration {
    pub recording_id: String,
    pub storage_key: String,
    /// Kept so a queued entry can still complete the Research Drive copy if
    /// that is the step that failed.
    pub local_path: String,
    pub archived: bool,
    pub payload: ClosePayload,
    pub attempts: u32,
    pub last_error: Option<String>,
    pub queued_at: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Joins a path onto a configured base URL, tolerating a trailing slash.
/// One implementation for both modes — see shared/http.rs.
pub fn endpoint(base_url: &str, path: &str) -> String {
    crate::shared::http::endpoint(base_url, path)
}

/// Turns a failed response into something an RA can act on.
async fn describe_failure(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    // A misrouted request returns a whole HTML error page; that belongs
    // nowhere near an RA's screen. Same rule as the station side.
    let body = crate::station::remote::readable_body(&body);
    let body = body.as_str();
    match status.as_u16() {
        401 => "Round Robin rejected the shared secret. Check the secret in Settings.".into(),
        403 => "Round Robin refused this request. Check that the secret has recording access.".into(),
        404 => "Round Robin does not recognise that session. Check the session and room.".into(),
        409 => format!(
            "Round Robin already has a recording in progress for this room and round. {body}"
        ),
        503 => "Round Robin has no RECORDING_DIR configured, so it has nowhere to file this.".into(),
        _ => format!("Round Robin returned {status}. {body}"),
    }
}

pub async fn list_sessions(base_url: &str, secret: &str) -> Result<Vec<SessionSummary>, String> {
    let response = client()?
        .get(endpoint(base_url, "api/pps/sessions"))
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {base_url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }

    #[derive(Deserialize)]
    struct Wrapper {
        sessions: Vec<SessionSummary>,
    }
    response
        .json::<Wrapper>()
        .await
        .map(|w| w.sessions)
        .map_err(|e| format!("Round Robin sent something unexpected: {e}"))
}

pub async fn open_recording(
    base_url: &str,
    secret: &str,
    slot_id: &str,
    room_index: i32,
    round: Option<i32>,
    force: bool,
) -> Result<OpenedRecording, String> {
    let mut body = serde_json::json!({
        "slotId": slot_id,
        "roomIndex": room_index,
        "mimeType": "video/mp4",
        // The extension has to travel with the request: storageKeyFor defaults
        // to webm, which is what the browser recorder writes.
        "extension": "mp4",
        "force": force,
    });
    if let Some(round) = round {
        body["round"] = serde_json::json!(round);
    }

    let response = client()?
        .post(endpoint(base_url, "api/recordings"))
        .bearer_auth(secret)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {base_url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }
    response
        .json::<OpenedRecording>()
        .await
        .map_err(|e| format!("Round Robin sent something unexpected: {e}"))
}

pub async fn close_recording(
    base_url: &str,
    secret: &str,
    recording_id: &str,
    payload: &ClosePayload,
) -> Result<(), String> {
    let response = client()?
        .post(endpoint(
            base_url,
            &format!("api/recordings/{recording_id}/close"),
        ))
        .bearer_auth(secret)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {base_url}: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response).await);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

pub fn queue_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("pending-registrations.json")
}

pub fn load_queue(app: &AppHandle) -> Vec<PendingRegistration> {
    std::fs::read_to_string(queue_path(app))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_queue(app: &AppHandle, queue: &[PendingRegistration]) -> Result<(), String> {
    let path = queue_path(app);
    let text = serde_json::to_string_pretty(queue)
        .map_err(|e| format!("could not serialise the pending queue: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Adds an entry, replacing any earlier attempt for the same recording so the
/// queue cannot accumulate duplicates of one take.
pub fn enqueue(app: &AppHandle, entry: PendingRegistration) -> Result<(), String> {
    let mut queue = load_queue(app);
    queue.retain(|e| e.recording_id != entry.recording_id);
    queue.push(entry);
    save_queue(app, &queue)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlushReport {
    pub attempted: usize,
    pub succeeded: usize,
    pub still_pending: usize,
    pub errors: Vec<String>,
}

/// Retries every queued registration. Called at launch and from the UI.
pub async fn flush(app: &AppHandle, base_url: &str, secret: &str) -> Result<FlushReport, String> {
    let queue = load_queue(app);
    let attempted = queue.len();
    let mut remaining: Vec<PendingRegistration> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut succeeded = 0usize;

    let drive_root = crate::machine::drive_root(app);

    for mut entry in queue {
        // The copy may be the step that failed last time, so retry it first.
        if !entry.archived {
            match drive_root.as_deref() {
                Some(root) => {
                    let target = crate::recorder::archive::resolve_storage_path(
                        std::path::Path::new(root),
                        &entry.storage_key,
                    )
                    .and_then(|dest| {
                        crate::recorder::archive::copy_verified(
                            std::path::Path::new(&entry.local_path),
                            &dest,
                            &entry.payload.sha256,
                        )
                    });
                    match target {
                        Ok(_) => entry.archived = true,
                        Err(e) => {
                            entry.attempts += 1;
                            entry.last_error = Some(e.clone());
                            errors.push(e);
                            remaining.push(entry);
                            continue;
                        }
                    }
                }
                None => {
                    let e = "No Research Drive folder is configured, so queued recordings cannot be filed.".to_string();
                    entry.attempts += 1;
                    entry.last_error = Some(e.clone());
                    errors.push(e);
                    remaining.push(entry);
                    continue;
                }
            }
        }

        match close_recording(base_url, secret, &entry.recording_id, &entry.payload).await {
            Ok(()) => succeeded += 1,
            Err(e) => {
                entry.attempts += 1;
                entry.last_error = Some(e.clone());
                errors.push(e);
                remaining.push(entry);
            }
        }
    }

    let still_pending = remaining.len();
    save_queue(app, &remaining)?;
    Ok(FlushReport {
        attempted,
        succeeded,
        still_pending,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_tolerates_a_trailing_slash() {
        assert_eq!(
            endpoint("https://rr.example/", "api/recordings"),
            "https://rr.example/api/recordings"
        );
        assert_eq!(
            endpoint("https://rr.example", "/api/recordings"),
            "https://rr.example/api/recordings"
        );
        assert_eq!(
            endpoint("https://rr.example/base/", "/api/x"),
            "https://rr.example/base/api/x"
        );
    }

    #[test]
    fn queue_replaces_rather_than_duplicates_a_retry() {
        // Exercised through the pure list operation the enqueue path performs,
        // so it does not need an AppHandle.
        let mut queue = vec![sample("rec-1"), sample("rec-2")];
        let replacement = PendingRegistration {
            attempts: 3,
            ..sample("rec-1")
        };
        queue.retain(|e| e.recording_id != replacement.recording_id);
        queue.push(replacement);

        assert_eq!(queue.len(), 2);
        assert_eq!(queue.iter().filter(|e| e.recording_id == "rec-1").count(), 1);
        assert_eq!(queue.last().unwrap().attempts, 3);
    }

    #[test]
    fn a_queued_entry_round_trips_through_json() {
        // The queue outlives the process — that is its whole purpose — so it has
        // to survive serialisation exactly.
        let entry = sample("rec-9");
        let text = serde_json::to_string(&entry).unwrap();
        let back: PendingRegistration = serde_json::from_str(&text).unwrap();
        assert_eq!(back.recording_id, "rec-9");
        assert_eq!(back.payload.frames_dropped, 4);
        assert_eq!(back.payload.sha256, "abc123");
        assert!(!back.archived);
    }

    #[test]
    fn close_payload_uses_the_field_names_round_robin_expects() {
        let json = serde_json::to_value(sample("x").payload).unwrap();
        for key in [
            "durationMs",
            "captureFps",
            "framesDropped",
            "framesDuplicated",
            "sha256",
            "profileHash",
            "recorderVersion",
            "cfr",
            "bytes",
        ] {
            assert!(json.get(key).is_some(), "missing {key} in close payload");
        }
    }

    fn sample(id: &str) -> PendingRegistration {
        PendingRegistration {
            recording_id: id.into(),
            storage_key: "slot/round-1/room-1-aaaa-bbbb.mp4".into(),
            local_path: "D:/captures/take.mp4".into(),
            archived: false,
            payload: ClosePayload {
                duration_ms: 600_000,
                capture_fps: 30,
                frames_dropped: 4,
                frames_duplicated: 1,
                sha256: "abc123".into(),
                profile_hash: "9f2c00112233".into(),
                recorder_version: "0.1.0".into(),
                cfr: true,
                bytes: 850_000_000,
            },
            attempts: 0,
            last_error: None,
            queued_at: "2026-08-11T14:03:12Z".into(),
        }
    }
}
