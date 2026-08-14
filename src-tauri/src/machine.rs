// Which role this machine plays.
//
// Phase 3 grows this into the full machine profile: the shared Round Robin
// URL + secret + Research Drive root entered once per machine, the first-run
// wizard commands, and migration from the two standalone apps' app-data. For
// now it is exactly enough to boot the suite into a role.

use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Conversation-room machine: the Lab Recorder.
    Record,
    /// Rating-station machine: the PPS study app. (Phase 2.)
    Station,
    /// RA machine: an embedded window on the Round Robin site. (Phase 4.)
    Control,
    /// No role chosen yet: the first-run wizard. (Phase 3.)
    Setup,
}

pub fn current_role(app: &AppHandle) -> Role {
    // Dev override so `npm run tauri dev` can target any mode without editing
    // app-data. Debug builds only — a release install ignores it.
    if cfg!(debug_assertions) {
        if let Ok(value) = std::env::var("SUITE_ROLE") {
            if let Some(role) = parse_role(&value) {
                return role;
            }
        }
    }
    // Until the wizard exists, an unconfigured machine boots as a recorder —
    // the only mode implemented in phase 1. Phase 3 changes this default to
    // Setup.
    machine_json_role(app).unwrap_or(Role::Record)
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

fn machine_json_role(app: &AppHandle) -> Option<Role> {
    #[derive(Deserialize)]
    struct Partial {
        role: Option<String>,
    }
    let path = app.path().app_data_dir().ok()?.join("machine.json");
    let text = std::fs::read_to_string(path).ok()?;
    let parsed: Partial = serde_json::from_str(&text).ok()?;
    parse_role(parsed.role?.as_str())
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
}
