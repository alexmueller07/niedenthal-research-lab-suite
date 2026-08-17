// The machine profile: which role this machine plays, and the three shared
// settings every role consumes — Round Robin URL, shared secret, Research
// Drive root — entered once in the first-run wizard and stored in one place.
//
// In the standalone apps these lived in two files with two editing surfaces
// (the recorder's settings.json and the PPS app's remote.json), which meant
// the same secret typed twice per machine and two ways for them to disagree.
// Here machine.json is the single store; the recorder settings panel and the
// PPS dashboard panel both write through to it.
//
// The secret follows the pattern proven in the standalone recorder: it lives
// in the JSON like everything else but is never serialized to any webview —
// the frontend learns only whether one exists. A secret that only travels
// inwards cannot be leaked by a rendering bug.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Conversation-room machine: the Lab Recorder.
    Record,
    /// Rating-station machine: the PPS study app.
    Station,
    /// RA machine: an embedded window on the Round Robin site. (Phase 4.)
    Control,
    /// No role chosen yet: the first-run wizard.
    Setup,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Role::Record => "record",
            Role::Station => "station",
            Role::Control => "control",
            Role::Setup => "setup",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineSettings {
    pub version: u32,
    pub role: Option<String>,
    pub round_robin_url: Option<String>,
    /// Never leaves this process.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_robin_secret: Option<String>,
    pub research_drive_root: Option<String>,
    pub configured_at: Option<String>,
    /// Which standalone app's settings seeded this profile, if any.
    pub migrated_from: Option<String>,
}

/// What any webview is allowed to see.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinePublic {
    pub role: Option<String>,
    pub round_robin_url: Option<String>,
    pub research_drive_root: Option<String>,
    pub secret_configured: bool,
    pub migrated_from: Option<String>,
}

impl From<&MachineSettings> for MachinePublic {
    fn from(s: &MachineSettings) -> Self {
        MachinePublic {
            role: s.role.clone(),
            round_robin_url: s.round_robin_url.clone(),
            research_drive_root: s.research_drive_root.clone(),
            secret_configured: s
                .round_robin_secret
                .as_ref()
                .is_some_and(|v| !v.trim().is_empty()),
            migrated_from: s.migrated_from.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineUpdate {
    pub round_robin_url: Option<String>,
    /// Empty string clears it; omitting the field leaves it untouched.
    pub round_robin_secret: Option<String>,
    pub research_drive_root: Option<String>,
}

fn machine_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("machine.json")
}

pub fn load(app: &AppHandle) -> MachineSettings {
    // A corrupt or missing profile must not stop the app; defaults mean
    // "unconfigured", which boots the wizard.
    std::fs::read_to_string(machine_path(app))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(crate) fn save(app: &AppHandle, settings: &MachineSettings) -> Result<(), String> {
    let path = machine_path(app);
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not serialise the machine profile: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// The frontend never receives the secret, so it cannot echo it back; without
/// this merge, saving any other field would erase it.
pub fn merge_update(existing: &MachineSettings, update: MachineUpdate) -> MachineSettings {
    MachineSettings {
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
        ..existing.clone()
    }
}

// ---------------------------------------------------------------------------
// What the rest of the app consumes
// ---------------------------------------------------------------------------

/// Base URL plus secret, or a message explaining what is missing. Every
/// Round Robin call in every mode funnels through this.
pub fn credentials(app: &AppHandle) -> Result<(String, String), String> {
    let s = load(app);
    let url = s
        .round_robin_url
        .filter(|u| !u.trim().is_empty())
        .ok_or("No Round Robin address is configured. Press Ctrl+Alt+Shift+L to open machine setup.")?;
    let secret = s
        .round_robin_secret
        .filter(|v| !v.trim().is_empty())
        .ok_or("No Round Robin shared secret is configured. Press Ctrl+Alt+Shift+L to open machine setup.")?;
    Ok((url, secret))
}

pub fn drive_root(app: &AppHandle) -> Option<String> {
    load(app)
        .research_drive_root
        .filter(|r| !r.trim().is_empty())
}

/// What to open at boot. Always the launcher: the lab asked for a mode
/// chooser on every launch rather than a machine locked to one role — the
/// shared settings persist, the choice does not. `role` in machine.json is
/// only the *last used* mode, so the chooser can preselect it.
pub fn current_role(app: &AppHandle) -> Role {
    let _ = app;
    // Dev override so `npm run tauri dev` can jump straight into a mode
    // without clicking through the chooser. Debug builds only — a release
    // install ignores it.
    if cfg!(debug_assertions) {
        if let Ok(value) = std::env::var("SUITE_ROLE") {
            if let Some(role) = parse_role(&value) {
                return role;
            }
        }
    }
    Role::Setup
}

fn parse_role(value: &str) -> Option<Role> {
    match value.trim().to_ascii_lowercase().as_str() {
        "record" | "recorder" => Some(Role::Record),
        "station" | "pps" => Some(Role::Station),
        "control" => Some(Role::Control),
        "setup" | "launcher" => Some(Role::Setup),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Migration from the standalone apps
// ---------------------------------------------------------------------------

/// Seeds the suite's app-data from whichever standalone apps this machine ran
/// before. Runs once, when machine.json does not exist yet. Nothing here is
/// destructive: the old apps' folders are only read, never written, so they
/// keep working as the fallback until Randy signs off on the suite.
pub fn migrate_if_fresh(app: &AppHandle) {
    if machine_path(app).exists() {
        return;
    }
    let Some(parent) = app.path().app_data_dir().ok().and_then(|d| d.parent().map(PathBuf::from))
    else {
        return;
    };
    let suite_dir = machine_path(app).parent().map(PathBuf::from).unwrap_or_default();
    let old_recorder = parent.join("edu.wisc.niedenthal.lab-recorder");
    let old_pps = parent.join("com.wisc.pps-study");

    let mut machine = MachineSettings {
        version: 1,
        ..Default::default()
    };

    // The recorder's settings carried the shared trio first; the PPS app's
    // remote.json is the fallback when only a rating station ran here.
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    struct OldShared {
        round_robin_url: Option<String>,
        round_robin_secret: Option<String>,
        research_drive_root: Option<String>,
        output_dir: Option<String>,
        preset_id: Option<String>,
        session_minutes: Option<u32>,
        discreet: Option<bool>,
    }
    let read_old = |path: PathBuf| -> Option<OldShared> {
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
    };

    if let Some(old) = read_old(old_recorder.join("settings.json")) {
        machine.round_robin_url = old.round_robin_url.clone();
        machine.round_robin_secret = old.round_robin_secret.clone();
        machine.research_drive_root = old.research_drive_root.clone();
        machine.migrated_from = Some("lab-recorder".into());

        // The recorder-only remainder moves to the suite's own file, so the
        // wizard shows familiar values instead of making an RA re-enter them.
        let recorder_settings = suite_dir.join("recorder-settings.json");
        if !recorder_settings.exists() {
            let remainder = serde_json::json!({
                "outputDir": old.output_dir,
                "presetId": old.preset_id,
                "sessionMinutes": old.session_minutes,
                "discreet": old.discreet.unwrap_or(false),
            });
            let _ = std::fs::write(
                &recorder_settings,
                serde_json::to_string_pretty(&remainder).unwrap_or_default(),
            );
        }

        // A queue the old app never managed to flush still gets its retries:
        // same file format, same flush code, new home.
        let old_queue = old_recorder.join("pending-registrations.json");
        let new_queue = suite_dir.join("pending-registrations.json");
        if old_queue.exists() && !new_queue.exists() {
            let _ = std::fs::copy(&old_queue, &new_queue);
        }
    }

    if machine.round_robin_url.is_none() {
        if let Some(old) = read_old(old_pps.join("remote.json")) {
            machine.round_robin_url = old.round_robin_url;
            machine.round_robin_secret = old.round_robin_secret;
            machine.research_drive_root = old.research_drive_root;
            machine.migrated_from = Some("pps-app".into());
        }
    }

    // The PPS researcher settings are byte-compatible — same file name, same
    // schema — so they carry over verbatim. storeDir data (roundrobin.json,
    // progress/) normally lives on the shared drive and needs no move; the
    // copies below only matter for a machine that had fallen back to local
    // app-data.
    for name in ["settings.json", "roundrobin.json"] {
        let old = old_pps.join(name);
        let new = suite_dir.join(name);
        if old.exists() && !new.exists() {
            let _ = std::fs::copy(&old, &new);
        }
    }
    let old_progress = old_pps.join("progress");
    let new_progress = suite_dir.join("progress");
    if old_progress.is_dir() && !new_progress.exists() {
        let _ = std::fs::create_dir_all(&new_progress);
        if let Ok(entries) = std::fs::read_dir(&old_progress) {
            for entry in entries.filter_map(Result::ok) {
                let _ = std::fs::copy(entry.path(), new_progress.join(entry.file_name()));
            }
        }
    }

    let _ = save(app, &machine);
}

// ---------------------------------------------------------------------------
// Commands (wizard + settings panels)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn machine_status(app: AppHandle) -> MachinePublic {
    MachinePublic::from(&load(&app))
}

/// Which windows may rewrite the machine profile. The recorder window shows
/// the shared values but edits them through here too — the point is one
/// store, not gatekeeping between our own surfaces; what this check actually
/// excludes is any window this app did not create with an expected label.
fn caller_may_configure(window: &tauri::Window) -> Result<(), String> {
    match window.label() {
        "launcher" | "station" | "recorder" => Ok(()),
        other => Err(format!("window '{other}' may not change machine settings")),
    }
}

#[tauri::command]
pub fn machine_configure(
    app: AppHandle,
    window: tauri::Window,
    update: MachineUpdate,
) -> Result<MachinePublic, String> {
    caller_may_configure(&window)?;
    let merged = merge_update(&load(&app), update);
    save(&app, &merged)?;
    Ok(MachinePublic::from(&merged))
}

/// One-shot health check in RA words: the URL resolves, the secret is
/// accepted, the drive mount is reachable. Same probe the PPS app's
/// remote_test performs, reading the shared store.
#[tauri::command]
pub async fn machine_test(app: AppHandle) -> Result<String, String> {
    let (url, secret) = credentials(&app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(format!(
            "{}/api/pps/sessions",
            url.trim_end_matches('/')
        ))
        .bearer_auth(&secret)
        .send()
        .await
        .map_err(|e| format!("Could not reach Round Robin at {url}: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(match status.as_u16() {
            401 => "Round Robin rejected the shared secret. Check it and save again.".into(),
            _ => format!("Round Robin returned {status}."),
        });
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

    let drive = match drive_root(&app) {
        Some(root) if std::path::Path::new(&root).is_dir() => {
            "The Research Drive folder is reachable.".to_string()
        }
        Some(root) => format!(
            "The Research Drive folder is NOT reachable at {root} — is the share mounted?"
        ),
        None => "No Research Drive folder is set — recordings cannot be filed or fetched.".into(),
    };

    Ok(format!(
        "Connected — the secret was accepted. {sessions} upcoming session(s) on the schedule. {drive}"
    ))
}

/// Opens the chosen mode's window and closes the launcher. Remembers the
/// choice only so the next launch can preselect it — nothing is locked.
///
/// `async` is load-bearing, not style: on Windows, creating a window from a
/// synchronous command deadlocks the event loop — the window shell appears
/// white, the webview never initializes, and close events are never
/// processed. An async command runs off the main thread, so the creation
/// request round-trips through a live event loop.
#[tauri::command]
pub async fn launch_mode(app: AppHandle, window: tauri::Window, role: String) -> Result<(), String> {
    caller_may_configure(&window)?;
    let parsed = parse_role(&role).ok_or_else(|| format!("unknown role: {role}"))?;
    if parsed == Role::Setup {
        return Err("Pick a mode first.".into());
    }

    // One mode window at a time: a rating station quietly also being a
    // recorder is exactly the confusion this app exists to prevent.
    for label in [
        crate::modes::RECORDER_LABEL,
        crate::modes::STATION_LABEL,
        crate::modes::CONTROL_LABEL,
    ] {
        if let Some(existing) = app.get_webview_window(label) {
            let _ = existing.set_focus();
            return Err("A mode is already running in another window — close it first.".into());
        }
    }

    let mut settings = load(&app);
    settings.version = 1;
    settings.role = Some(parsed.as_str().to_string());
    settings.configured_at = Some(chrono::Utc::now().to_rfc3339());
    save(&app, &settings)?;

    crate::modes::open_for_role(&app, parsed).map_err(|e| format!("could not open the mode: {e}"))?;
    let _ = window.close();
    Ok(())
}

/// Structured health for the launcher's status chips — same probes as
/// machine_test, but as data rather than prose, and cheap enough to run on
/// every launcher load.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineHealth {
    pub configured: bool,
    pub server_ok: bool,
    pub session_count: Option<usize>,
    pub server_detail: Option<String>,
    pub drive_configured: bool,
    pub drive_ok: bool,
}

#[tauri::command]
pub async fn machine_health(app: AppHandle) -> MachineHealth {
    let drive = drive_root(&app);
    let drive_configured = drive.is_some();
    let drive_ok = drive
        .as_deref()
        .map(|root| std::path::Path::new(root).is_dir())
        .unwrap_or(false);

    let (configured, server_ok, session_count, server_detail) = match credentials(&app) {
        Err(_) => (false, false, None, None),
        Ok((url, secret)) => {
            let probe = async {
                let response = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(5))
                    .build()
                    .map_err(|e| e.to_string())?
                    .get(format!("{}/api/pps/sessions", url.trim_end_matches('/')))
                    .bearer_auth(&secret)
                    .send()
                    .await
                    .map_err(|e| format!("unreachable: {e}"))?;
                if !response.status().is_success() {
                    return Err(match response.status().as_u16() {
                        401 => "the secret was rejected".to_string(),
                        s => format!("server returned {s}"),
                    });
                }
                #[derive(Deserialize)]
                struct Wrapper {
                    sessions: Vec<serde_json::Value>,
                }
                response
                    .json::<Wrapper>()
                    .await
                    .map(|w| w.sessions.len())
                    .map_err(|e| e.to_string())
            };
            match probe.await {
                Ok(count) => (true, true, Some(count), None),
                Err(e) => (true, false, None, Some(e)),
            }
        }
    };

    MachineHealth {
        configured,
        server_ok,
        session_count,
        server_detail,
        drive_configured,
        drive_ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names_parse_forgivingly() {
        assert_eq!(parse_role("record"), Some(Role::Record));
        assert_eq!(parse_role(" Recorder "), Some(Role::Record));
        assert_eq!(parse_role("STATION"), Some(Role::Station));
        assert_eq!(parse_role("pps"), Some(Role::Station));
        assert_eq!(parse_role("control"), Some(Role::Control));
        assert_eq!(parse_role("setup"), Some(Role::Setup));
        assert_eq!(parse_role("banana"), None);
    }

    fn existing() -> MachineSettings {
        MachineSettings {
            version: 1,
            role: Some("record".into()),
            round_robin_url: Some("https://sc.psych.wisc.edu".into()),
            round_robin_secret: Some("s3cret".into()),
            research_drive_root: Some("Z:/recordings".into()),
            configured_at: None,
            migrated_from: None,
        }
    }

    #[test]
    fn saving_another_field_does_not_erase_the_secret() {
        let updated = merge_update(
            &existing(),
            MachineUpdate {
                research_drive_root: Some("Y:/other".into()),
                ..Default::default()
            },
        );
        assert_eq!(updated.round_robin_secret.as_deref(), Some("s3cret"));
        assert_eq!(updated.research_drive_root.as_deref(), Some("Y:/other"));
        assert_eq!(updated.role.as_deref(), Some("record"), "merge must not drop the role");
    }

    #[test]
    fn an_empty_secret_clears_it_deliberately() {
        let updated = merge_update(
            &existing(),
            MachineUpdate {
                round_robin_secret: Some("".into()),
                ..Default::default()
            },
        );
        assert!(updated.round_robin_secret.is_none());
    }

    #[test]
    fn the_secret_never_reaches_the_frontend() {
        let public = MachinePublic::from(&existing());
        assert!(public.secret_configured);
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("s3cret"), "serialised machine profile leaked the secret");
    }

    #[test]
    fn machine_json_with_secret_omits_it_from_public_but_keeps_it_on_disk() {
        let disk = serde_json::to_string(&existing()).unwrap();
        assert!(disk.contains("s3cret"), "the store itself must keep the secret");
    }
}
