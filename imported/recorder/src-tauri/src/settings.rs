// Per-machine settings, stored next to the app rather than in the repo.
//
// The shared secret is the reason this file is careful. It lives in the settings
// JSON like the rest, but it is never sent back to the webview — the frontend
// receives a boolean saying whether one is configured, and nothing more. A
// secret that only travels inwards cannot be leaked by a rendering bug, and
// nothing in the UI ever needs to display it.
//
// Follows pps-app's approach: custom Rust commands over std::fs rather than the
// filesystem plugin, with everything under app_data_dir.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: bool,

    /// Base URL of the Round Robin deployment, e.g. https://roundrobin.example.
    pub round_robin_url: Option<String>,
    /// Shared secret for the desktop-app auth path. Never leaves this process.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_robin_secret: Option<String>,
    /// Local mount of the Research Drive share that RECORDING_DIR points at on
    /// the server. Windows: a mapped letter or a UNC path. macOS: /Volumes/...
    pub research_drive_root: Option<String>,
}

/// What the frontend is allowed to see.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: bool,
    pub round_robin_url: Option<String>,
    pub research_drive_root: Option<String>,
    /// Whether a secret exists — never the secret itself.
    pub round_robin_secret_configured: bool,
}

impl From<&AppSettings> for PublicSettings {
    fn from(s: &AppSettings) -> Self {
        PublicSettings {
            output_dir: s.output_dir.clone(),
            preset_id: s.preset_id.clone(),
            session_minutes: s.session_minutes,
            discreet: s.discreet,
            round_robin_url: s.round_robin_url.clone(),
            research_drive_root: s.research_drive_root.clone(),
            round_robin_secret_configured: s
                .round_robin_secret
                .as_ref()
                .is_some_and(|v| !v.trim().is_empty()),
        }
    }
}

pub fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
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

/// Applies an update from the frontend, preserving the secret when the caller
/// did not supply a new one.
///
/// The frontend never receives the secret, so it cannot echo it back. Without
/// this merge, saving any other setting would erase it.
pub fn merge_update(existing: &AppSettings, update: SettingsUpdate) -> AppSettings {
    AppSettings {
        output_dir: update.output_dir.or_else(|| existing.output_dir.clone()),
        preset_id: update.preset_id.or_else(|| existing.preset_id.clone()),
        session_minutes: update.session_minutes.or(existing.session_minutes),
        discreet: update.discreet.unwrap_or(existing.discreet),
        round_robin_url: update
            .round_robin_url
            .or_else(|| existing.round_robin_url.clone()),
        research_drive_root: update
            .research_drive_root
            .or_else(|| existing.research_drive_root.clone()),
        round_robin_secret: match update.round_robin_secret {
            // An empty string is an explicit "clear it"; absent means "leave it".
            Some(s) if s.trim().is_empty() => None,
            Some(s) => Some(s),
            None => existing.round_robin_secret.clone(),
        },
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsUpdate {
    pub output_dir: Option<String>,
    pub preset_id: Option<String>,
    pub session_minutes: Option<u32>,
    pub discreet: Option<bool>,
    pub round_robin_url: Option<String>,
    pub round_robin_secret: Option<String>,
    pub research_drive_root: Option<String>,
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
            round_robin_url: Some("https://rr.example".into()),
            round_robin_secret: Some("s3cret".into()),
            research_drive_root: Some("Z:/round-robin/recordings".into()),
        }
    }

    #[test]
    fn the_secret_never_reaches_the_frontend() {
        let public = PublicSettings::from(&existing());
        assert!(public.round_robin_secret_configured);
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("s3cret"), "serialised settings leaked the secret");
    }

    #[test]
    fn an_absent_secret_reports_as_unconfigured() {
        let mut s = existing();
        s.round_robin_secret = None;
        assert!(!PublicSettings::from(&s).round_robin_secret_configured);
        s.round_robin_secret = Some("   ".into());
        assert!(!PublicSettings::from(&s).round_robin_secret_configured);
    }

    #[test]
    fn saving_another_field_does_not_erase_the_secret() {
        // The frontend cannot echo back a secret it was never given, so a naive
        // overwrite would wipe it on the first settings change.
        let updated = merge_update(
            &existing(),
            SettingsUpdate {
                output_dir: Some("E:/other".into()),
                ..Default::default()
            },
        );
        assert_eq!(updated.round_robin_secret.as_deref(), Some("s3cret"));
        assert_eq!(updated.output_dir.as_deref(), Some("E:/other"));
    }

    #[test]
    fn an_empty_secret_clears_it_deliberately() {
        let updated = merge_update(
            &existing(),
            SettingsUpdate {
                round_robin_secret: Some("".into()),
                ..Default::default()
            },
        );
        assert!(updated.round_robin_secret.is_none());
    }

    #[test]
    fn a_new_secret_replaces_the_old_one() {
        let updated = merge_update(
            &existing(),
            SettingsUpdate {
                round_robin_secret: Some("fresh".into()),
                ..Default::default()
            },
        );
        assert_eq!(updated.round_robin_secret.as_deref(), Some("fresh"));
    }

    #[test]
    fn discreet_false_is_distinguishable_from_absent() {
        let off = merge_update(
            &existing(),
            SettingsUpdate {
                discreet: Some(false),
                ..Default::default()
            },
        );
        assert!(!off.discreet, "an explicit false must not be read as 'unchanged'");
        let untouched = merge_update(&existing(), SettingsUpdate::default());
        assert!(untouched.discreet);
    }
}
