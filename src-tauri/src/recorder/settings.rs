// Recorder-only per-machine settings.
//
// In the standalone app this file also carried the Round Robin URL, shared
// secret, and Research Drive root. Those are machine-wide, not
// recorder-specific, so in the suite they live in machine.json (machine.rs)
// — entered once, consumed by every mode. What remains here is exactly what
// only the recorder cares about. The frontend's PublicSettings wire shape is
// unchanged: commands.rs composes it from this file plus the machine profile,
// and updates that touch the shared trio are written through to the machine
// store, so the recorder settings panel keeps working as it always did.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::machine::MachineSettings;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: bool,
    /// Which Round Robin room this machine records. A conversation-room
    /// computer physically *is* one room, so remembering it means the RA
    /// picks it once and never again.
    pub room_index: Option<u32>,
}

/// What the frontend is allowed to see. Same wire shape as the standalone
/// app: the shared fields are filled in from machine.json.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: bool,
    pub room_index: Option<u32>,
    pub round_robin_url: Option<String>,
    pub research_drive_root: Option<String>,
    /// Whether a secret exists — never the secret itself.
    pub round_robin_secret_configured: bool,
}

pub fn compose_public(recorder: &AppSettings, machine: &MachineSettings) -> PublicSettings {
    PublicSettings {
        output_dir: recorder.output_dir.clone(),
        preset_id: recorder.preset_id.clone(),
        session_minutes: recorder.session_minutes,
        discreet: recorder.discreet,
        room_index: recorder.room_index,
        round_robin_url: machine.round_robin_url.clone(),
        research_drive_root: machine.research_drive_root.clone(),
        round_robin_secret_configured: machine
            .round_robin_secret
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty()),
    }
}

pub fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    // recorder-settings.json, not settings.json: in the suite the PPS station
    // owns the plain settings.json name (byte-compatible with its standalone
    // install), and the two must never compete for one file again.
    dir.join("recorder-settings.json")
}

pub fn load(app: &AppHandle) -> AppSettings {
    // A corrupt or missing settings file must not stop the app from recording;
    // defaults are always usable.
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app);
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not serialise settings: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Applies the recorder-only half of an update. The shared fields the wire
/// format still carries (round_robin_url/secret, research_drive_root) are
/// split off by commands.rs and written through to machine.json — the secret
/// merge semantics live there now, in one implementation.
pub fn merge_update(existing: &AppSettings, update: &SettingsUpdate) -> AppSettings {
    AppSettings {
        output_dir: update
            .output_dir
            .clone()
            .or_else(|| existing.output_dir.clone()),
        preset_id: update
            .preset_id
            .clone()
            .or_else(|| existing.preset_id.clone()),
        session_minutes: update.session_minutes.or(existing.session_minutes),
        discreet: update.discreet.unwrap_or(existing.discreet),
        room_index: update.room_index.or(existing.room_index),
    }
}

/// The wire shape the recorder frontend sends — unchanged from the standalone
/// app, shared fields included.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsUpdate {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: Option<bool>,
    pub room_index: Option<u32>,
    pub round_robin_url: Option<String>,
    pub round_robin_secret: Option<String>,
    pub research_drive_root: Option<String>,
}

impl SettingsUpdate {
    /// True when the update touches any machine-wide field.
    pub fn touches_machine(&self) -> bool {
        self.round_robin_url.is_some()
            || self.round_robin_secret.is_some()
            || self.research_drive_root.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing() -> AppSettings {
        AppSettings {
            output_dir: Some("D:/captures".into()),
            preset_id: Some("lab-standard".into()),
            session_minutes: Some(10),
            discreet: true,
            room_index: Some(1),
        }
    }

    fn machine_with_secret() -> MachineSettings {
        MachineSettings {
            round_robin_url: Some("https://sc.psych.wisc.edu".into()),
            round_robin_secret: Some("s3cret".into()),
            research_drive_root: Some("Z:/round-robin/recordings".into()),
            ..Default::default()
        }
    }

    #[test]
    fn the_secret_never_reaches_the_frontend() {
        let public = compose_public(&existing(), &machine_with_secret());
        assert!(public.round_robin_secret_configured);
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("s3cret"), "serialised settings leaked the secret");
    }

    #[test]
    fn an_absent_secret_reports_as_unconfigured() {
        let mut machine = machine_with_secret();
        machine.round_robin_secret = None;
        assert!(!compose_public(&existing(), &machine).round_robin_secret_configured);
        machine.round_robin_secret = Some("   ".into());
        assert!(!compose_public(&existing(), &machine).round_robin_secret_configured);
    }

    #[test]
    fn the_public_shape_carries_the_machine_fields() {
        // The recorder frontend's PublicSettings type is unchanged from the
        // standalone app; the shared trio now arrives from machine.json.
        let public = compose_public(&existing(), &machine_with_secret());
        assert_eq!(public.round_robin_url.as_deref(), Some("https://sc.psych.wisc.edu"));
        assert_eq!(
            public.research_drive_root.as_deref(),
            Some("Z:/round-robin/recordings")
        );
        assert_eq!(public.output_dir.as_deref(), Some("D:/captures"));
    }

    #[test]
    fn a_machine_touching_update_is_detected_for_write_through() {
        let plain = SettingsUpdate {
            output_dir: Some("E:/other".into()),
            ..Default::default()
        };
        assert!(!plain.touches_machine());
        let shared = SettingsUpdate {
            round_robin_secret: Some("fresh".into()),
            ..Default::default()
        };
        assert!(shared.touches_machine());
    }

    #[test]
    fn discreet_false_is_distinguishable_from_absent() {
        let off = merge_update(
            &existing(),
            &SettingsUpdate {
                discreet: Some(false),
                ..Default::default()
            },
        );
        assert!(!off.discreet, "an explicit false must not be read as 'unchanged'");
        let untouched = merge_update(&existing(), &SettingsUpdate::default());
        assert!(untouched.discreet);
    }
}
