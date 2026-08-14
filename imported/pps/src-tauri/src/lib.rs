mod remote;

use tauri_plugin_fs::FsExt;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::fs;

// Writes continuous slider samples to ratings.csv.
// Header does not include saveFolder — it is redundant with the directory path.
#[tauri::command]
fn write_csv_ratings(path: String, contents: Vec<String>) -> Result<(), String> {
    let file_exists = Path::new(&path).exists();

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;

    if !file_exists {
        writeln!(
            file,
            "SubID,PartnerID,dyad,computer,subjectInitials,raName,sessionTime,sessionDate,\
timestamp,taskOrder,Rating,EmoRating,EmoRating_Person,Time,stopTime,Movietime,\
Shift,Description,trialNumber,softwareVersion"
        )
        .map_err(|e| e.to_string())?;
    }

    for line in contents {
        writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Writes classification-task responses to transitions.csv.
#[tauri::command]
fn write_csv_transitions(path: String, contents: Vec<String>) -> Result<(), String> {
    let file_exists = Path::new(&path).exists();

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;

    if !file_exists {
        writeln!(
            file,
            "dyadId,participantId,partnerId,computer,subjectInitials,raName,sessionTime,\
sessionDate,sessionTimestamp,ratingTask,subTask,emotion1,emotion2,ratingPerson,\
response,trialNumber,softwareVersion"
        )
        .map_err(|e| e.to_string())?;
    }

    for line in contents {
        writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Exits the process. The frontend flushes any buffered data before calling this,
// so it does no saving itself. This is the only sanctioned way to quit the app
// (triggered by the researcher save-and-quit gate); it uses app.exit, which
// bypasses the CloseRequested guard installed in `run`.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ---- Researcher settings ----
//
// settings.json always lives in this machine's app-data directory, because one
// of the things it holds is where everything else lives. The frontend owns the
// schema; Rust only reads the two path fields it needs.
//
//   stimulusDir — the video clip library (mp4_noname). Clips are not shipped in
//                 the installer, so the lab points this at the copy on the
//                 Research Drive.
//   storeDir    — where the round-robin and progress files live. Point every
//                 lab machine at one shared folder and the dashboard sees all
//                 of them; leave it unset and each machine keeps its own.

fn app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("settings.json"))
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let path = settings_path(&app)?;
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ---- Round-robin tracking store ----
//
// Holds the cross-day round-robin state (participants, groups, which pairs have
// met) plus one progress file per participant. It contains participant emails,
// so it must stay on the lab machine / UW Research Drive and is never part of
// the repo. The frontend owns the schema; these commands only move bytes.

// The configured shared folder, or this machine's app-data folder when unset or
// unusable. Falling back rather than erroring matters: a Research Drive that is
// not mounted yet must not stop a session from running.
fn store_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let local = app_data(app)?;
    let settings_file = local.join("settings.json");
    if let Ok(raw) = fs::read_to_string(&settings_file) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(dir) = value.get("storeDir").and_then(|v| v.as_str()) {
                let candidate = std::path::PathBuf::from(dir);
                if !dir.is_empty() && fs::create_dir_all(&candidate).is_ok() {
                    return Ok(candidate);
                }
                eprintln!("configured storeDir unusable, falling back to app data: {dir}");
            }
        }
    }
    Ok(local)
}

fn roundrobin_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(store_dir(app)?.join("roundrobin.json"))
}

fn progress_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = store_dir(app)?.join("progress");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Progress filenames come from the frontend, so they are validated rather than
// trusted: exactly `p-<8 hex digits>.json`, which cannot escape the directory.
fn is_valid_progress_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    name.len() == 15
        && name.starts_with("p-")
        && name.ends_with(".json")
        && bytes[2..10].iter().all(|b| b.is_ascii_hexdigit())
}

// Every participant's progress file, as raw JSON strings.
#[tauri::command]
fn load_progress(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = progress_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !is_valid_progress_name(&name) {
            continue;
        }
        // A single unreadable file must not hide everyone else's progress.
        match fs::read_to_string(entry.path()) {
            Ok(contents) => out.push(contents),
            Err(e) => eprintln!("skipping progress file {name}: {e}"),
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_progress(app: tauri::AppHandle, file_name: String, contents: String) -> Result<(), String> {
    if !is_valid_progress_name(&file_name) {
        return Err(format!("invalid progress file name: {file_name}"));
    }
    let path = progress_dir(&app)?.join(file_name);
    fs::write(&path, contents).map_err(|e| e.to_string())
}

// Returns the stored JSON, or "" when no store exists yet.
#[tauri::command]
fn load_roundrobin(app: tauri::AppHandle) -> Result<String, String> {
    let path = roundrobin_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_roundrobin(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let path = roundrobin_path(&app)?;
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Creates the session folder and returns its absolute path.
#[tauri::command]
fn setup_rating_directory(
    base_path: String,
    dyad_id: String,
    participant_id: String,
    partner_id: String,
    initials: String,
) -> Result<String, String> {
    let dyad_folder = format!(
        "{}/{}_{}_{}_{}",
        base_path, dyad_id, participant_id, partner_id, initials
    );
    fs::create_dir_all(&dyad_folder).map_err(|e| e.to_string())?;
    Ok(dyad_folder)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Researcher save-and-quit combo registered at the OS level. The old
        // webview keydown listener only fired when the page had keyboard
        // focus, which the app does not always have — that is why Ctrl+Shift+Q
        // felt unreliable. A global shortcut fires regardless of focus; the
        // frontend keydown handler remains as a fallback.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyQ)
                        || shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyQ)
                    {
                        use tauri::Emitter;
                        let _ = app.emit("admin-quit", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let scope = app.fs_scope();
            let _ = scope.allow_directory("/", false);
            use tauri::Manager;

            // Register Ctrl+Shift+Q (and Cmd+Shift+Q on macOS). Failure is
            // non-fatal — the in-page keydown listener still works.
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
                // `mut` is only used on macOS, which adds the Cmd variant.
                #[allow(unused_mut)]
                let mut wanted = vec![(
                    "ctrl+shift+q",
                    Modifiers::CONTROL | Modifiers::SHIFT,
                    Code::KeyQ,
                )];
                #[cfg(target_os = "macos")]
                wanted.push(("cmd+shift+q", Modifiers::SUPER | Modifiers::SHIFT, Code::KeyQ));
                for (name, modifiers, code) in wanted {
                    let shortcut = Shortcut::new(Some(modifiers), code);
                    if let Err(e) = app.global_shortcut().register(shortcut) {
                        eprintln!("global shortcut ({name}) registration failed: {e}");
                    }
                }
            }

            // The window is an ordinary window: movable, resizable, minimizable,
            // and free to be left behind on another virtual desktop. Randy and
            // Alex, 2026-08-04 — the kiosk lock (fullscreen + always-on-top +
            // no decorations + skipTaskbar) was removed because it followed the
            // operator across desktops and there was no way out of it.
            //
            // The one thing kept from the lock is the data guarantee: closing
            // the window would drop up to ~15 s of buffered slider samples, so
            // the close button opens the same save-and-quit confirmation that
            // Ctrl+Shift+Q does instead of exiting on the spot. Confirming it
            // flushes to disk and calls `exit_app` (app.exit), which bypasses
            // this guard.
            let window = app.get_webview_window("main").unwrap();
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use tauri::Emitter;
                    api.prevent_close();
                    let _ = handle.emit("admin-quit", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_csv_ratings,
            write_csv_transitions,
            setup_rating_directory,
            exit_app,
            load_roundrobin,
            save_roundrobin,
            load_settings,
            save_settings,
            load_progress,
            save_progress,
            remote::remote_status,
            remote::remote_configure,
            remote::remote_test,
            remote::list_conversation_clips,
            remote::report_study_progress,
            remote::prepare_conversation_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
