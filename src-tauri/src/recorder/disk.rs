// Free space, and the arithmetic behind "how much room will this take?".
//
// The size readout is not decoration. A researcher choosing settings has no way
// to know that 1080p60 at high bitrate is four times the file of the preset
// below it, and finding out by filling the drive halfway through a session is
// an expensive way to learn. Under constant bitrate the answer is arithmetic,
// so the app states it plainly instead of hedging.

use std::path::Path;

use serde::{Deserialize, Serialize};
use sysinfo::Disks;

/// Refuse to start when the projected recording would leave less than this
/// fraction of its own size as headroom. Encoders overshoot, other software
/// writes to the same drive, and a full disk mid-session loses the take.
pub const HEADROOM_FRACTION: f64 = 0.20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

/// The volume a path lives on. Picks the longest matching mount point, because
/// on Unix every path also matches "/".
pub fn disk_for_path(path: &Path) -> Option<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    let target = path.to_string_lossy().to_lowercase();

    let mut best: Option<DiskInfo> = None;
    let mut best_len = 0usize;
    for disk in &disks {
        let mount = disk.mount_point().to_string_lossy().to_lowercase();
        if target.starts_with(&mount) && mount.len() >= best_len {
            best_len = mount.len();
            best = Some(DiskInfo {
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
            });
        }
    }
    best
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceEstimate {
    /// None under constant-quality encoding, where size genuinely cannot be
    /// derived from the settings and has to be measured instead.
    pub projected_bytes: Option<u64>,
    pub bytes_per_minute: Option<u64>,
    pub available_bytes: u64,
    /// How many more recordings of this length fit, after headroom.
    pub sessions_remaining: Option<u64>,
    pub fits: bool,
    pub warning: Option<String>,
}

pub fn estimate(
    bytes_per_second: Option<u64>,
    duration_seconds: u64,
    available_bytes: u64,
) -> SpaceEstimate {
    let Some(rate) = bytes_per_second else {
        return SpaceEstimate {
            projected_bytes: None,
            bytes_per_minute: None,
            available_bytes,
            sessions_remaining: None,
            fits: true,
            warning: Some(
                "Constant-quality mode cannot predict file size from settings. Run Calibrate \
                 to measure the real rate on this camera and scene."
                    .into(),
            ),
        };
    };

    let projected = rate * duration_seconds;
    let needed = (projected as f64 * (1.0 + HEADROOM_FRACTION)) as u64;
    let fits = needed <= available_bytes;
    let sessions = if needed == 0 { 0 } else { available_bytes / needed };

    let warning = if !fits {
        Some(format!(
            "Not enough space. This recording needs about {} (including {}% headroom) but only {} is free.",
            human_bytes(needed),
            (HEADROOM_FRACTION * 100.0) as u32,
            human_bytes(available_bytes)
        ))
    } else if sessions < 3 {
        Some(format!(
            "Only room for about {sessions} more recordings at these settings. Free up space or choose a smaller preset."
        ))
    } else {
        None
    };

    SpaceEstimate {
        projected_bytes: Some(projected),
        bytes_per_minute: Some(rate * 60),
        available_bytes,
        sessions_remaining: Some(sessions),
        fits,
        warning,
    }
}

/// Decimal units, matching how operating systems and drive labels report size.
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else if value >= 100.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 12000 kbps video + 128 kbps audio, the Lab Standard preset.
    const LAB_STANDARD_BPS: u64 = 12_128 * 125;

    #[test]
    fn ten_minutes_of_lab_standard_is_about_900_mb() {
        let e = estimate(Some(LAB_STANDARD_BPS), 600, 500_000_000_000);
        let mb = e.projected_bytes.unwrap() as f64 / 1e6;
        assert!((mb - 909.6).abs() < 1.0, "got {mb} MB");
        assert!(e.fits);
    }

    #[test]
    fn per_minute_rate_is_reported_for_the_setup_screen() {
        let e = estimate(Some(LAB_STANDARD_BPS), 600, 500_000_000_000);
        let mb_per_min = e.bytes_per_minute.unwrap() as f64 / 1e6;
        assert!((mb_per_min - 90.96).abs() < 0.1);
    }

    #[test]
    fn refuses_when_headroom_would_be_eaten() {
        // Exactly the projected size available — no headroom, so no.
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, projected);
        assert!(!e.fits);
        assert!(e.warning.unwrap().contains("Not enough space"));
    }

    #[test]
    fn accepts_when_headroom_is_satisfied() {
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, (projected as f64 * 1.25) as u64);
        assert!(e.fits);
    }

    #[test]
    fn warns_before_the_drive_is_actually_full() {
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, projected * 2);
        assert!(e.fits);
        assert_eq!(e.sessions_remaining, Some(1));
        assert!(e.warning.unwrap().contains("more recordings"));
    }

    #[test]
    fn constant_quality_admits_it_cannot_predict() {
        let e = estimate(None, 600, 500_000_000_000);
        assert!(e.projected_bytes.is_none());
        assert!(e.fits, "an unknown size must not block recording");
        assert!(e.warning.unwrap().contains("Calibrate"));
    }

    #[test]
    fn byte_formatting_matches_how_drives_are_labelled() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(999), "999 B");
        assert_eq!(human_bytes(909_600_000), "910 MB");
        assert_eq!(human_bytes(1_500_000_000), "1.5 GB");
        assert_eq!(human_bytes(214_000_000_000), "214 GB");
    }
}
