// The machine profile: which role this machine plays, and the two settings
// every role consumes — the Round Robin URL and the Research Drive folder.
//
// In the standalone apps these lived in two files with two editing surfaces
// (the recorder's settings.json and the PPS app's remote.json), which meant
// the same values typed twice per machine and two ways for them to disagree.
// Here machine.json is the single store; the recorder settings panel and the
// PPS dashboard panel both write through to it.
//
// Device authentication (2026-08-22): the Round Robin API still requires a
// bearer token — it serves participant names, emails and schedules, and IRB
// 2020-1657 does not allow that to sit open on the public internet. What
// changed is who supplies it. It used to be an RA, pasting a "shared secret"
// into Settings on every machine; the lab's feedback was, reasonably, that
// nobody knew what it was. It is now baked into the installer at build time
// (see device_key) and never appears in any interface. Nothing to paste,
// nothing to lose, same authentication on the wire.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

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
    /// A device key typed by hand on this machine before the built-in one
    /// existed. Read so an already-configured lab machine keeps working
    /// across the upgrade; no interface writes it any more, and it never
    /// leaves this process.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_robin_secret: Option<String>,
    pub research_drive_root: Option<String>,
    /// Research Drive folders this machine has been pointed at before, newest
    /// first. Kept so setting one is a click rather than a walk through a
    /// folder tree: an RA re-mapping the share after a reboot, or a machine
    /// that alternates between the real share and a local test folder, would
    /// otherwise browse for it every time. Capped — this is a convenience,
    /// not a history.
    pub recent_drive_roots: Vec<String>,
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
    /// True when the Research Drive folder was chosen deliberately rather
    /// than falling back to this computer's own folder.
    pub drive_is_shared: bool,
    /// Previously used folders, newest first, for the one-click chips. Never
    /// includes the one currently in use — it is already on screen.
    pub recent_drive_roots: Vec<String>,
    pub migrated_from: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineUpdate {
    pub round_robin_url: Option<String>,
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
    // "unconfigured", which boots the wizard. The BOM strip is not
    // hypothetical: editors and scripts on Windows love writing UTF-8 with a
    // BOM, and serde_json refuses it — which silently read a hand-edited
    // profile as "unconfigured".
    std::fs::read_to_string(machine_path(app))
        .ok()
        .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub(crate) fn save(app: &AppHandle, settings: &MachineSettings) -> Result<(), String> {
    let path = machine_path(app);
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not serialise the machine profile: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// An update carries only the fields the caller touched, so every other field
/// — including the legacy device key, which no interface can see — has to be
/// carried across rather than defaulted away.
pub fn merge_update(existing: &MachineSettings, update: MachineUpdate) -> MachineSettings {
    let research_drive_root = update
        .research_drive_root
        .or_else(|| existing.research_drive_root.clone());
    MachineSettings {
        round_robin_url: update
            .round_robin_url
            .or_else(|| existing.round_robin_url.clone()),
        recent_drive_roots: remember_drive_root(
            &existing.recent_drive_roots,
            existing.research_drive_root.as_deref(),
            research_drive_root.as_deref(),
        ),
        research_drive_root,
        ..existing.clone()
    }
}

/// How many previous folders are offered as chips. Four fits on one line next
/// to the label and is more than any lab machine has ever needed.
const MAX_RECENT_DRIVE_ROOTS: usize = 4;

/// Research Drive folders that exist on this computer right now.
///
/// The share is mounted at the same handful of places on every lab machine, so
/// a machine that has never been configured can still offer a click instead of
/// a folder tree. Existence is the whole test — a path that is there is worth
/// offering, and one that is not is silently skipped.
///
/// `async` so it never runs on the UI thread: probing a mapped letter whose
/// server has gone away can block for seconds, and this is called while an RA
/// is looking at a settings screen.
#[tauri::command]
pub async fn detect_drive_roots(app: AppHandle) -> Vec<String> {
    let current = load(&app)
        .research_drive_root
        .map(|r| r.trim().to_lowercase())
        .filter(|r| !r.is_empty());

    let mut candidates: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // A mapped letter is how the lab reaches the share day to day.
        for letter in b'D'..=b'Z' {
            let letter = letter as char;
            candidates.push(format!("{letter}:\\niedenthal\\recordings"));
            candidates.push(format!("{letter}:\\recordings"));
        }
        // And the UNC path, for a machine that never mapped one.
        candidates.push("\\\\research.drive.wisc.edu\\niedenthal\\recordings".into());
    }
    #[cfg(not(target_os = "windows"))]
    {
        candidates.push("/Volumes/niedenthal/recordings".into());
        candidates.push("/Volumes/niedenthal".into());
    }

    let mut found: Vec<String> = Vec::new();
    for candidate in candidates {
        if found.len() >= MAX_RECENT_DRIVE_ROOTS {
            break;
        }
        if Some(candidate.to_lowercase()) == current {
            continue;
        }
        if std::path::Path::new(&candidate).is_dir() {
            found.push(candidate);
        }
    }
    found
}

/// Folds the folder being replaced into the recents list.
///
/// The one being *set* is deliberately not added: it is about to be displayed
/// as the current folder, and a chip offering to switch to the folder you are
/// already using is noise. The one being replaced is what an RA might want
/// back.
fn remember_drive_root(
    existing: &[String],
    previous: Option<&str>,
    next: Option<&str>,
) -> Vec<String> {
    let mut recents: Vec<String> = existing.to_vec();
    if let Some(previous) = previous.map(str::trim).filter(|p| !p.is_empty()) {
        if next.map(str::trim) != Some(previous) {
            recents.insert(0, previous.to_string());
        }
    }
    // Dedupe case-insensitively, keeping the newest occurrence: Windows paths
    // differ only by case all the time (r:\ vs R:\) and are the same folder.
    let mut seen: Vec<String> = Vec::new();
    recents.retain(|path| {
        let key = path.to_lowercase();
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
    // And never offer the folder that is currently in use.
    if let Some(next) = next.map(str::trim).filter(|n| !n.is_empty()) {
        let key = next.to_lowercase();
        recents.retain(|path| path.to_lowercase() != key);
    }
    recents.truncate(MAX_RECENT_DRIVE_ROOTS);
    recents
}

/// The machine profile as a webview sees it: effective values, not raw stored
/// ones. Both the server address and the recordings folder have working
/// defaults, and a screen that reads them empty concludes the machine is
/// unconfigured when it is not.
pub fn public_view(app: &AppHandle) -> MachinePublic {
    let stored = load(app);
    MachinePublic {
        role: stored.role.clone(),
        round_robin_url: Some(server_url(app)),
        research_drive_root: drive_root(app),
        drive_is_shared: !drive_is_local_fallback(app),
        recent_drive_roots: stored.recent_drive_roots.clone(),
        migrated_from: stored.migrated_from,
    }
}

// ---------------------------------------------------------------------------
// What the rest of the app consumes
// ---------------------------------------------------------------------------

/// The lab's Round Robin deployment. Baked in so a fresh install has a
/// working server without anyone typing a URL: it is already running, on the
/// public internet, and it is the same one every lab machine coordinates
/// through. A machine that needs a different one (the UW server, once that
/// lands) overrides it in Settings.
pub const DEFAULT_ROUND_ROBIN_URL: &str = "https://niedenthal-round-robin.vercel.app";

/// The server address this machine should use.
pub fn server_url(app: &AppHandle) -> String {
    load(app)
        .round_robin_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_ROUND_ROBIN_URL.to_string())
}

/// The device key this build authenticates to Round Robin with, compiled in
/// from `LAB_SUITE_DEVICE_KEY` at build time (the release workflow passes the
/// repository secret, which holds the same value as the server's
/// `PPS_SHARED_SECRET`).
///
/// Why compiled in rather than typed: the previous design asked an RA to
/// paste a "shared secret" into Settings on every machine. It authenticated
/// correctly and nobody understood it, which made it the single most common
/// reason a fresh install could not see a session. Installers only ever go to
/// lab staff, so binding the key to the build costs nothing an RA can
/// mishandle and removes the whole concept from the interface.
///
/// A build made without the variable — a local `npm run tauri build`, a fork —
/// gets the development value, which authenticates against a locally run
/// server and nothing else. `machine_self_test` names that case in words
/// rather than reporting a bare 401.
const BUILT_IN_DEVICE_KEY: &str = match option_env!("LAB_SUITE_DEVICE_KEY") {
    Some(key) => key,
    None => DEV_DEVICE_KEY,
};

/// What a build with no key compiled in uses. Matches the default in the
/// Round Robin repo's `.env.example`, so a local server and a local build
/// talk to each other with no setup.
const DEV_DEVICE_KEY: &str = "dev-local-only";

/// True when this build fell back to the development key. The self-test says
/// so plainly: against the lab's real server it is the difference between "the
/// server is down" and "this copy was built on someone's laptop".
pub fn is_dev_build_key() -> bool {
    option_env!("LAB_SUITE_DEVICE_KEY").is_none()
}

/// This machine's Round Robin credentials: the server address and the device
/// key. Every Round Robin call in every mode funnels through this.
///
/// Infallible by design. It used to return an error meaning "no secret was
/// pasted on this machine", and every caller had to render that sentence; the
/// key now always exists, so the only failures left are real ones — the
/// server being down, or refusing the key.
///
/// Precedence: a key typed on this machine before the built-in one existed
/// (so an already-working lab machine keeps working), then a key set in the
/// environment (an escape hatch for the day the server's key is rotated and
/// nobody wants to wait for a release), then the built-in one.
pub fn credentials(app: &AppHandle) -> (String, String) {
    let stored = load(app);
    let url = stored
        .round_robin_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_ROUND_ROBIN_URL.to_string());
    let key = stored
        .round_robin_secret
        .filter(|v| !v.trim().is_empty())
        .or_else(|| std::env::var("LAB_SUITE_DEVICE_KEY").ok().filter(|v| !v.trim().is_empty()))
        .unwrap_or_else(|| BUILT_IN_DEVICE_KEY.to_string());
    (url, key)
}

/// Where recordings are read and written.
///
/// Defaults to a folder this app owns, so a machine with no Research Drive
/// mapped still records, still files, and a rating station on the same
/// machine still finds the video — which is the whole pipeline, working, with
/// nothing configured. Pointing this at the mounted Research Drive is what
/// makes it work *across* machines, and is the one thing an admin sets when
/// the lab is ready.
pub fn drive_root(app: &AppHandle) -> Option<String> {
    if let Some(configured) = load(app)
        .research_drive_root
        .filter(|r| !r.trim().is_empty())
    {
        return Some(configured);
    }
    let fallback = app
        .path()
        .app_data_dir()
        .ok()?
        .join("recordings");
    std::fs::create_dir_all(&fallback).ok()?;
    Some(fallback.to_string_lossy().to_string())
}

/// True when the drive is this machine's own folder rather than a share —
/// the UI says so plainly rather than implying recordings are going somewhere
/// other machines can see.
pub fn drive_is_local_fallback(app: &AppHandle) -> bool {
    load(app)
        .research_drive_root
        .filter(|r| !r.trim().is_empty())
        .is_none()
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

/// Where Control mode should point its window.
///
/// Trades the shared secret this machine already holds for a one-minute
/// login token, so the dashboard opens without an RA typing the lab
/// password. Any failure falls back to the ordinary /admin URL: the RA meets
/// the password page, which is inconvenient but never a dead end — and is
/// exactly what a browser outside the app gets.
pub async fn control_url(app: &AppHandle) -> String {
    let base = server_url(app).trim_end_matches('/').to_string();
    let fallback = format!("{base}/admin");
    let (_, secret) = credentials(app);

    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    else {
        return fallback;
    };

    #[derive(Deserialize)]
    struct Minted {
        token: String,
    }
    match client
        .post(format!("{base}/api/pps/control-token"))
        .bearer_auth(&secret)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match response.json::<Minted>().await {
            Ok(minted) => format!(
                "{base}/admin/app-login?token={}",
                urlencoding_minimal(&minted.token)
            ),
            Err(_) => fallback,
        },
        _ => fallback,
    }
}

/// The token is base64url plus dots and percent-encoded fields, so the only
/// characters needing escaping in a query string are `%` and `+`. Escaping
/// those by hand avoids a dependency for one call site.
fn urlencoding_minimal(token: &str) -> String {
    token.replace('%', "%25").replace('+', "%2B")
}

/// One line of the self-test.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub label: String,
    /// None while a check does not apply to this machine.
    pub passed: Option<bool>,
    pub detail: String,
}

/// Everything that has to be true before a session, checked in one click.
///
/// Every failure this app has produced in testing was a precondition nobody
/// had a way to see: a server not serving its API, a database missing a
/// column so every recording failed to register, a drive path that no longer
/// resolved, a camera delivering nothing. Each was found by running a session
/// and watching it break. This is the same information, fifteen seconds
/// before instead of ten minutes after.
#[tauri::command]
pub async fn machine_self_test(app: AppHandle) -> Vec<CheckResult> {
    let mut out: Vec<CheckResult> = Vec::new();

    // ---- which build is this ----
    // First, because it explains half the ways the next check can fail. An RA
    // reading "the server did not accept this copy" needs to know whether they
    // are holding the lab's installer or something built on a laptop.
    let has_stored_key = load(&app)
        .round_robin_secret
        .is_some_and(|v| !v.trim().is_empty());
    out.push(CheckResult {
        label: "This copy of the app".into(),
        // None renders as a tick with the detail beside it: a local build on a
        // machine that was set up under the old scheme works fine, and calling
        // that a failure would teach RAs to ignore a red mark.
        passed: match (is_dev_build_key(), has_stored_key) {
            (false, _) => Some(true),
            (true, true) => None,
            (true, false) => Some(false),
        },
        detail: match (is_dev_build_key(), has_stored_key) {
            (false, _) => format!(
                "Version {} from the lab's build — nothing to configure for the server.",
                env!("CARGO_PKG_VERSION")
            ),
            (true, true) =>
                "Built locally rather than downloaded, but this machine still holds a key from \
                 an earlier setup, so the server accepts it."
                    .into(),
            (true, false) =>
                "Built locally, so it carries the development key and the lab's server will \
                 refuse it. Fine against a server running on this machine; install the copy \
                 from the lab's download page for anything real."
                    .into(),
        },
    });

    // ---- server ----
    let (url, secret) = credentials(&app);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok();
    match client {
        None => out.push(CheckResult {
            label: "Round Robin server".into(),
            passed: Some(false),
            detail: "Could not create a network client on this machine.".into(),
        }),
        Some(client) => {
            let sessions_url =
                format!("{}/api/pps/sessions", url.trim_end_matches('/'));
            match client.get(&sessions_url).bearer_auth(&secret).send().await {
                Err(e) => out.push(CheckResult {
                    label: "Round Robin server".into(),
                    passed: Some(false),
                    detail: format!(
                        "Cannot reach {url}. Is the server running? ({e})"
                    ),
                }),
                Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
                    out.push(CheckResult {
                        label: "Round Robin server".into(),
                        passed: Some(false),
                        detail: if is_dev_build_key() {
                            "The server is up but does not accept this copy of the app. It was built locally, so it carries the development key rather than the lab's. Install the copy from the lab's download page.".into()
                        } else {
                            "The server is up but did not accept this copy of the app. Its key may have been rotated — tell Alex, and a new installer fixes it.".to_string()
                        },
                    })
                }
                Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {
                    out.push(CheckResult {
                        label: "Round Robin server".into(),
                        passed: Some(false),
                        detail: "The address answers but has no API. It is serving a stale build — restart it (START-TEST-SERVER.bat rebuilds cleanly).".into(),
                    })
                }
                Ok(r) if !r.status().is_success() => out.push(CheckResult {
                    label: "Round Robin server".into(),
                    passed: Some(false),
                    detail: format!("The server answered {}.", r.status()),
                }),
                Ok(r) => {
                    #[derive(Deserialize)]
                    struct W {
                        sessions: Vec<serde_json::Value>,
                    }
                    let n = r.json::<W>().await.map(|w| w.sessions.len()).unwrap_or(0);
                    out.push(CheckResult {
                        label: "Round Robin server".into(),
                        passed: Some(true),
                        detail: format!(
                            "Connected, {n} upcoming session(s) on the schedule."
                        ),
                    });

                    // ---- database schema ----
                    // The integrity columns were missing from the live
                    // database once, and the only symptom was every
                    // recording silently failing to register.
                    let probe = format!(
                        "{}/api/pps/session-clips",
                        url.trim_end_matches('/')
                    );
                    match client.get(&probe).bearer_auth(&secret).send().await {
                        Ok(r) if r.status().is_success() => out.push(CheckResult {
                            label: "Recording database".into(),
                            passed: Some(true),
                            detail: "The server can read recordings and their checksums.".into(),
                        }),
                        Ok(r) => out.push(CheckResult {
                            label: "Recording database".into(),
                            passed: Some(false),
                            detail: format!(
                                "The server could not read its recordings table ({}). Its database may need `npm run db:setup`.",
                                r.status()
                            ),
                        }),
                        Err(e) => out.push(CheckResult {
                            label: "Recording database".into(),
                            passed: Some(false),
                            detail: format!("Could not check: {e}"),
                        }),
                    }
                }
            }
        }
    }

    // ---- recordings folder ----
    let local_fallback = drive_is_local_fallback(&app);
    match drive_root(&app) {
        None => out.push(CheckResult {
            label: "Recordings folder".into(),
            passed: Some(false),
            detail: "No folder is set and this machine's own app folder could not be created."
                .into(),
        }),
        Some(root) => {
            let path = std::path::Path::new(&root);
            if !path.is_dir() {
                out.push(CheckResult {
                    label: "Recordings folder".into(),
                    passed: Some(false),
                    detail: format!("{root} is not reachable. Is the share mounted?"),
                });
            } else {
                // Readable is not writable, and a recording room finds out at
                // the worst moment. Prove it with a real file.
                let probe = path.join(".labsuite-write-test");
                match std::fs::write(&probe, b"ok") {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&probe);
                        out.push(CheckResult {
                            label: "Recordings folder".into(),
                            passed: Some(true),
                            detail: if local_fallback {
                                format!(
                                    "NOT the Research Drive — this computer's own folder \
                                     ({root}). Recording and rating both work on this one \
                                     machine, but a rating station on a different computer \
                                     cannot reach these files. Set the Research Drive folder \
                                     in Settings."
                                )
                            } else {
                                format!("Research Drive at {root} — mounted and writable.")
                            },
                        });
                    }
                    Err(e) => out.push(CheckResult {
                        label: "Recordings folder".into(),
                        passed: Some(false),
                        detail: format!("{root} is readable but not writable: {e}"),
                    }),
                }
            }
        }
    }

    // ---- encoder ----
    let encoder = crate::recorder::ffmpeg::best_encoder(&app).await;
    let hardware = encoder != "libx264";
    out.push(CheckResult {
        label: "Video encoder".into(),
        passed: Some(true),
        detail: if hardware {
            format!("{encoder} (hardware) — this machine can encode in real time.")
        } else {
            "libx264 (software). No hardware encoder found; run Preflight in Recording mode before a session to confirm this machine keeps up.".into()
        },
    });

    // ---- camera and microphone ----
    match crate::recorder::devices::list_devices(&app).await {
        Err(e) => out.push(CheckResult {
            label: "Camera".into(),
            passed: Some(false),
            detail: format!("Could not list devices: {e}"),
        }),
        Ok(devices) => {
            let cameras: Vec<_> = devices.iter().filter(|d| d.kind == crate::recorder::devices::DeviceKind::Video).collect();
            let mics: Vec<_> = devices.iter().filter(|d| d.kind == crate::recorder::devices::DeviceKind::Audio).collect();
            out.push(CheckResult {
                label: "Camera".into(),
                passed: Some(!cameras.is_empty()),
                detail: if cameras.is_empty() {
                    "No camera this app can record from. A laptop's built-in camera is often hidden from recording software — plug in a USB webcam.".into()
                } else {
                    format!("{} available: {}", cameras.len(), cameras[0].name)
                },
            });
            out.push(CheckResult {
                label: "Microphone".into(),
                passed: Some(!mics.is_empty()),
                detail: if mics.is_empty() {
                    "No microphone found.".into()
                } else {
                    format!(
                        "{} available: {}. Watch the level meter in Recording mode — a muted mic still shows here.",
                        mics.len(),
                        mics[0].name
                    )
                },
            });
        }
    }

    // ---- anything waiting to be filed ----
    let pending = crate::recorder::roundrobin::load_queue(&app).len();
    out.push(CheckResult {
        label: "Recordings waiting to be filed".into(),
        passed: Some(pending == 0),
        detail: if pending == 0 {
            "None — everything recorded on this machine has been filed.".into()
        } else {
            format!("{pending} waiting. They retry automatically; open Recording mode to force one now.")
        },
    });

    out
}

#[tauri::command]
pub fn machine_status(app: AppHandle) -> MachinePublic {
    public_view(&app)
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
    Ok(public_view(&app))
}

/// One-shot health check in RA words: the URL resolves, this build is
/// accepted, the drive mount is reachable. Same probe the PPS app's
/// remote_test performs, reading the shared store.
#[tauri::command]
pub async fn machine_test(app: AppHandle) -> Result<String, String> {
    let (url, secret) = credentials(&app);
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
            401 if is_dev_build_key() => "Round Robin did not accept this copy of the app. It was built locally, so it carries the development key rather than the lab's. Install the copy from the lab's download page.".into(),
            401 => "Round Robin did not accept this copy of the app. Its key may have been rotated — tell Alex, and a new installer fixes it.".into(),
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
        "Connected to Round Robin. {sessions} upcoming session(s) on the schedule. {drive}"
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
pub async fn launch_mode(
    app: AppHandle,
    window: tauri::Window,
    role: String,
    force: Option<bool>,
) -> Result<(), String> {
    caller_may_configure(&window)?;
    let parsed = parse_role(&role).ok_or_else(|| format!("unknown role: {role}"))?;
    if parsed == Role::Setup {
        return Err("Pick a mode first.".into());
    }

    // One mode window at a time: a rating station quietly also being a
    // recorder is exactly the confusion this app exists to prevent. What
    // changed (2026-08-22) is what happens when one is already open — it used
    // to be a dead end that said "close it first" without offering a way to.
    if let Some(label) = crate::modes::running_mode_label(&app) {
        if !force.unwrap_or(false) {
            if let Some(existing) = app.get_webview_window(label) {
                let _ = existing.set_focus();
            }
            return Err(format!("__MODE_RUNNING__{label}"));
        }
        if crate::modes::recording_in_progress(&app) {
            return Err(
                "A recording is running on this machine. Stop the take before switching modes."
                    .into(),
            );
        }
        let Some(existing) = app.get_webview_window(label) else {
            // It closed itself between the two checks. Nothing to do.
            return Ok(());
        };
        if label == crate::modes::CONTROL_LABEL {
            // Control mode is a browsing window on the Round Robin site with
            // no IPC and no local state, so there is nothing to ask it to
            // save — and nothing there to ask, either.
            let _ = existing.destroy();
        } else {
            // Ask the mode to leave under its own power: it knows what it is
            // holding (buffered slider samples, an open settings draft) and
            // calls leave_mode once that is on disk. The launcher watches
            // running_mode() and offers a hard close if nothing happens.
            let _ = existing.emit("leave-mode", parsed.as_str());
            return Ok(());
        }
    }

    // Control mode is nothing but the Round Robin site in a window — opening
    // it against a dead server would hand the RA a bare browser error page.
    // Probe first and fail here instead, where the launcher can say it in
    // words next to the working settings button. Any HTTP response counts as
    // alive; auth is the site's own business.
    if parsed == Role::Control {
        let url = server_url(&app);
        let reachable = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .map_err(|e| e.to_string())?
            .get(&url)
            .send()
            .await
            .is_ok();
        if !reachable {
            return Err(format!(
                "Round Robin at {url} is not reachable right now. If you are testing locally, \
                 start the server first (START-TEST-SERVER.bat, or `npm run dev` in the \
                 round-robin folder), then try again."
            ));
        }
    }

    let mut settings = load(&app);
    settings.version = 1;
    settings.role = Some(parsed.as_str().to_string());
    settings.configured_at = Some(chrono::Utc::now().to_rfc3339());
    save(&app, &settings)?;

    crate::modes::open_for_role(&app, parsed)
        .await
        .map_err(|e| format!("could not open the mode: {e}"))?;
    let _ = window.close();
    Ok(())
}

/// Which mode is open right now, as the launcher's own name for it. `None`
/// means nothing but the chooser is up.
#[tauri::command]
pub fn running_mode(app: AppHandle) -> Option<String> {
    crate::modes::running_mode_label(&app).map(|label| {
        match label {
            crate::modes::RECORDER_LABEL => "record",
            crate::modes::STATION_LABEL => "station",
            _ => "control",
        }
        .to_string()
    })
}

/// Called by a mode that is done: go to another mode, or back to the chooser.
///
/// The caller has already flushed whatever it was holding — that is the whole
/// reason this is the mode's decision to make rather than something done to
/// it from outside.
#[tauri::command]
pub async fn leave_mode(
    app: AppHandle,
    window: tauri::Window,
    role: Option<String>,
) -> Result<(), String> {
    if !crate::modes::MODE_LABELS.contains(&window.label()) {
        return Err(format!("window '{}' is not a mode", window.label()));
    }
    if crate::modes::recording_in_progress(&app) {
        return Err("A recording is running. Stop the take first.".into());
    }
    let target = match role.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
        Some(r) => Some(parse_role(r).ok_or_else(|| format!("unknown role: {r}"))?),
        None => None,
    };
    if let Some(role) = target {
        let mut settings = load(&app);
        settings.role = Some(role.as_str().to_string());
        save(&app, &settings)?;
    }
    let Some(handle) = app.get_webview_window(window.label()) else {
        return Ok(());
    };
    // A chooser opened over the mode (Ctrl+Alt+Shift+L) would otherwise be
    // left behind the new window with a stale "a mode is running" banner.
    if target.is_some() {
        if let Some(launcher) = app.get_webview_window(crate::modes::LAUNCHER_LABEL) {
            let _ = launcher.destroy();
        }
    }
    crate::modes::leave_mode(&app, &handle, target)
        .await
        .map_err(|e| format!("could not leave the mode: {e}"))
}

/// The launcher's fallback when a mode was asked to leave and did not.
///
/// Only ever reached after the polite request, and the button that calls it
/// says what it costs. A running recording still refuses.
#[tauri::command]
pub fn force_close_mode(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    caller_may_configure(&window)?;
    if crate::modes::recording_in_progress(&app) {
        return Err(
            "A recording is running on this machine. Stop the take before closing Recording mode."
                .into(),
        );
    }
    if let Some(label) = crate::modes::running_mode_label(&app) {
        if let Some(existing) = app.get_webview_window(label) {
            let _ = existing.destroy();
        }
    }
    Ok(())
}

/// Quits the whole app from the chooser. Nothing is running at that point —
/// the chooser refuses to show this while a mode is open — but the shutdown
/// flag still has to be set, or the last window's Destroyed event reopens the
/// chooser on the way out.
#[tauri::command]
pub fn quit_suite(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    caller_may_configure(&window)?;
    if crate::modes::recording_in_progress(&app) {
        return Err("A recording is running on this machine. Stop the take first.".into());
    }
    crate::modes::begin_shutdown();
    app.exit(0);
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

    let (configured, server_ok, session_count, server_detail) = {
        let (url, secret) = credentials(&app);
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
                    401 => "this copy of the app was not accepted".to_string(),
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
            recent_drive_roots: Vec::new(),
            configured_at: None,
            migrated_from: None,
        }
    }

    #[test]
    fn saving_a_folder_does_not_erase_a_machines_legacy_device_key() {
        // A lab machine set up before the key was built in still holds one in
        // machine.json, and it wins over the built-in value. No interface can
        // see the field any more, so nothing can echo it back — which is
        // exactly why the merge has to carry it across untouched.
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
    fn the_public_shape_has_nowhere_to_put_a_device_key() {
        let public = MachinePublic {
            role: Some("station".into()),
            round_robin_url: Some("https://rr.example".into()),
            research_drive_root: Some("R:/niedenthal/recordings".into()),
            recent_drive_roots: Vec::new(),
            drive_is_shared: true,
            migrated_from: None,
        };
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("secret"), "the public machine shape grew a secret field");
    }

    #[test]
    fn a_legacy_device_key_stays_on_disk() {
        let disk = serde_json::to_string(&existing()).unwrap();
        assert!(disk.contains("s3cret"), "the store itself must keep the key");
    }

    #[test]
    fn a_build_without_a_compiled_key_falls_back_to_the_development_one() {
        // The self-test leans on this to tell "the server is down" apart from
        // "this copy was built on somebody's laptop".
        if is_dev_build_key() {
            assert_eq!(BUILT_IN_DEVICE_KEY, DEV_DEVICE_KEY);
        } else {
            assert_ne!(BUILT_IN_DEVICE_KEY, DEV_DEVICE_KEY);
        }
    }
}
