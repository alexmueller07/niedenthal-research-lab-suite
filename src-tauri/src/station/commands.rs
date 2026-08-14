// The PPS station command surface — every #[tauri::command] Station mode uses.
//
// This file was the standalone PPS app's lib.rs; the builder moved to the
// suite's lib.rs/modes.rs and the Round Robin client lives in the sibling
// remote.rs. Command names, signatures, and file formats in here are FROZEN:
// the station frontend ships byte-identical with the standalone app, so the
// strings it invokes and the JSON/CSV shapes it reads must not move.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::fs;

// Writes continuous slider samples to ratings.csv.
// Header does not include saveFolder — it is redundant with the directory path.
#[tauri::command]
pub fn write_csv_ratings(path: String, contents: Vec<String>) -> Result<(), String> {
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
pub fn write_csv_transitions(path: String, contents: Vec<String>) -> Result<(), String> {
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
// bypasses the CloseRequested guards installed in modes.rs.
//
// Suite addition: because it bypasses those guards, it is the one command that
// could kill FFmpeg mid-take without container finalization if it ever ran on
// a recorder machine. It refuses in that case — the frontend already catches
// and logs a rejection.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let recording = app
        .state::<crate::recorder::capture::RecorderState>()
        .active
        .lock()
        .map(|slot| {
            matches!(
                slot.as_ref().map(|s| s.kind),
                Some(crate::recorder::capture::SessionKind::Record)
            )
        })
        .unwrap_or(false);
    if recording {
        return Err(
            "A recording is still running on this machine. Stop it before quitting.".into(),
        );
    }
    app.exit(0);
    Ok(())
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

pub fn app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, contents: String) -> Result<String, String> {
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
pub fn store_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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

pub fn roundrobin_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(store_dir(app)?.join("roundrobin.json"))
}

pub fn progress_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = store_dir(app)?.join("progress");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Progress filenames come from the frontend, so they are validated rather than
// trusted: exactly `p-<8 hex digits>.json`, which cannot escape the directory.
pub fn is_valid_progress_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    name.len() == 15
        && name.starts_with("p-")
        && name.ends_with(".json")
        && bytes[2..10].iter().all(|b| b.is_ascii_hexdigit())
}

// Every participant's progress file, as raw JSON strings.
#[tauri::command]
pub fn load_progress(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
pub fn save_progress(app: tauri::AppHandle, file_name: String, contents: String) -> Result<(), String> {
    if !is_valid_progress_name(&file_name) {
        return Err(format!("invalid progress file name: {file_name}"));
    }
    let path = progress_dir(&app)?.join(file_name);
    fs::write(&path, contents).map_err(|e| e.to_string())
}

// Returns the stored JSON, or "" when no store exists yet.
#[tauri::command]
pub fn load_roundrobin(app: tauri::AppHandle) -> Result<String, String> {
    let path = roundrobin_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_roundrobin(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let path = roundrobin_path(&app)?;
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Creates the session folder and returns its absolute path.
#[tauri::command]
pub fn setup_rating_directory(
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
