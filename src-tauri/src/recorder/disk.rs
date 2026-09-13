// Free space, and the arithmetic behind "how much room will this take?".
//
// The size readout is not decoration. A researcher choosing settings has no way
// to know that 1080p60 at high bitrate is four times the file of the preset
// below it, and finding out by filling the drive halfway through a session is
// an expensive way to learn. Under constant bitrate the answer is arithmetic,
// so the app states it plainly instead of hedging.

use std::path::Path;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "windows"))]
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

/// The volume a path lives on, or None when this machine cannot say.
///
/// On Windows this asks the OS about the path itself rather than matching it
/// against a list of volumes. That distinction cost the lab a session: the
/// list comes from `sysinfo`, which enumerates volumes with `FindFirstVolumeW`
/// and then keeps only `DRIVE_FIXED` and `DRIVE_REMOVABLE` — so a mapped
/// network drive (`Z:\`) and a UNC share (`\\research.drive.wisc.edu\...`)
/// are never in it, and the Research Drive read as an unknown volume. Room B
/// then refused to record onto a drive with 563 GB free (2026-09-11).
///
/// `GetDiskFreeSpaceExW` is the API that answers for mapped drives and UNC
/// paths; `sysinfo` itself calls it, just only for volumes that already
/// survived that filter.
#[cfg(target_os = "windows")]
pub fn disk_for_path(path: &Path) -> Option<DiskInfo> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory_name: *const u16,
            free_bytes_available_to_caller: *mut u64,
            total_number_of_bytes: *mut u64,
            total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }

    // The API needs a directory that exists. A capture folder the RA has
    // chosen but not yet created is still on a real volume, so walk up.
    let mut probe = path;
    while !probe.is_dir() {
        probe = probe.parent()?;
    }

    let wide: Vec<u16> = OsStr::new(probe)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut available: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives the call,
    // and the three out-pointers are to live stack locals.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) };
    if ok == 0 {
        return None;
    }

    Some(DiskInfo {
        mount_point: volume_label(probe),
        total_bytes: total,
        available_bytes: available,
    })
}

/// What to call the volume in "563 GB free on ___".
///
/// `C:\`, or `\\server\share` for a UNC path, rather than the whole capture
/// folder — the readout is about the drive, not the directory.
#[cfg(target_os = "windows")]
fn volume_label(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    if let Some(rest) = text.strip_prefix("\\\\") {
        let mut parts = rest.splitn(3, '\\');
        if let (Some(server), Some(share)) = (parts.next(), parts.next()) {
            return format!("\\\\{server}\\{share}");
        }
        return text;
    }
    match text.as_bytes() {
        [drive, b':', ..] => format!("{}:\\", (*drive as char).to_ascii_uppercase()),
        _ => text,
    }
}

/// The volume a path lives on. Picks the longest matching mount point, because
/// on Unix every path also matches "/".
///
/// Compares whole path components rather than raw strings: a plain
/// `starts_with` matches `/mnt/data` against `/mnt/dataset/x`, which is the
/// wrong volume.
#[cfg(not(target_os = "windows"))]
pub fn disk_for_path(path: &Path) -> Option<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();

    let mut best: Option<DiskInfo> = None;
    let mut best_len = 0usize;
    for disk in &disks {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.components().count();
            if len >= best_len {
                best_len = len;
                best = Some(DiskInfo {
                    mount_point: mount.to_string_lossy().to_string(),
                    total_bytes: disk.total_space(),
                    available_bytes: disk.available_space(),
                });
            }
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
    available_bytes: Option<u64>,
) -> SpaceEstimate {
    let Some(rate) = bytes_per_second else {
        return SpaceEstimate {
            projected_bytes: None,
            bytes_per_minute: None,
            available_bytes: available_bytes.unwrap_or(0),
            sessions_remaining: None,
            fits: true,
            warning: Some(
                "Constant-quality mode cannot predict file size from settings. Run Calibrate \
                 to measure the real rate on this camera and scene."
                    .into(),
            ),
        };
    };

    // An unreadable drive is not a full drive. Some network shares refuse to
    // report a quota at all, and blocking Record over that would stop a
    // session for a question nobody needed answered — the same rule the
    // constant-quality branch above already follows. (2026-09-12)
    let Some(available_bytes) = available_bytes else {
        return SpaceEstimate {
            projected_bytes: Some(rate * duration_seconds),
            bytes_per_minute: Some(rate * 60),
            available_bytes: 0,
            sessions_remaining: None,
            fits: true,
            warning: Some(format!(
                "Free space on this drive could not be read, so it is not being checked. This \
                 recording needs about {}.",
                human_bytes(rate * duration_seconds)
            )),
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
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some(500_000_000_000));
        let mb = e.projected_bytes.unwrap() as f64 / 1e6;
        assert!((mb - 909.6).abs() < 1.0, "got {mb} MB");
        assert!(e.fits);
    }

    #[test]
    fn per_minute_rate_is_reported_for_the_setup_screen() {
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some(500_000_000_000));
        let mb_per_min = e.bytes_per_minute.unwrap() as f64 / 1e6;
        assert!((mb_per_min - 90.96).abs() < 0.1);
    }

    #[test]
    fn refuses_when_headroom_would_be_eaten() {
        // Exactly the projected size available — no headroom, so no.
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some(projected));
        assert!(!e.fits);
        assert!(e.warning.unwrap().contains("Not enough space"));
    }

    #[test]
    fn accepts_when_headroom_is_satisfied() {
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some((projected as f64 * 1.25) as u64));
        assert!(e.fits);
    }

    #[test]
    fn warns_before_the_drive_is_actually_full() {
        let projected = LAB_STANDARD_BPS * 600;
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some(projected * 2));
        assert!(e.fits);
        assert_eq!(e.sessions_remaining, Some(1));
        assert!(e.warning.unwrap().contains("more recordings"));
    }

    #[test]
    fn constant_quality_admits_it_cannot_predict() {
        let e = estimate(None, 600, Some(500_000_000_000));
        assert!(e.projected_bytes.is_none());
        assert!(e.fits, "an unknown size must not block recording");
        assert!(e.warning.unwrap().contains("Calibrate"));
    }

    /// The Room B regression, 2026-09-11.
    ///
    /// A mapped Research Drive reported no free space at all, because
    /// `sysinfo` does not enumerate network volumes on Windows. Unknown was
    /// then flattened to zero, `fits` came out false, and Record was disabled
    /// on a drive with 563 GB free. Unknown must never block a session.
    #[test]
    fn an_unreadable_drive_does_not_block_recording() {
        let e = estimate(Some(LAB_STANDARD_BPS), 600, None);
        assert!(e.fits, "an unknown free space must not block recording");
        assert_eq!(e.sessions_remaining, None, "it cannot honestly count sessions");
        let warning = e.warning.unwrap();
        assert!(
            warning.contains("could not be read"),
            "the warning must say why it is not checking: {warning}"
        );
        assert!(
            !warning.contains("Not enough space"),
            "an unreadable drive is not a full drive: {warning}"
        );
        // The size forecast is still knowable and still worth showing.
        assert!(e.projected_bytes.is_some());
        assert!(e.bytes_per_minute.is_some());
    }

    /// A genuinely full drive must still say so — the fix above must not have
    /// turned the space check off.
    #[test]
    fn a_readable_full_drive_still_blocks() {
        let e = estimate(Some(LAB_STANDARD_BPS), 600, Some(1_000_000));
        assert!(!e.fits);
        assert!(e.warning.unwrap().contains("Not enough space"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn a_volume_is_labelled_by_its_drive_or_share_not_the_whole_folder() {
        assert_eq!(volume_label(Path::new(r"C:\Users\x\captures")), r"C:\");
        assert_eq!(volume_label(Path::new(r"z:\UW_Fall2026")), r"Z:\");
        // Forward slashes are how this repo's own settings fixtures store
        // paths, and used to defeat the old string prefix match entirely.
        assert_eq!(volume_label(Path::new("D:/captures")), r"D:\");
        assert_eq!(
            volume_label(Path::new(r"\\research.drive.wisc.edu\niedenthal\recordings")),
            r"\\research.drive.wisc.edu\niedenthal"
        );
    }

    /// The real API, against paths that actually exist on this machine.
    ///
    /// The old implementation answered for local fixed drives only; this
    /// proves the replacement still answers for them, which is the half of
    /// the behaviour that was never broken.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_local_drive_reports_real_numbers() {
        let temp = std::env::temp_dir();
        let info = disk_for_path(&temp).expect("the temp directory is on a readable volume");
        assert!(info.total_bytes > 0, "a real volume has a size");
        assert!(info.available_bytes <= info.total_bytes);
        assert!(
            info.mount_point.len() >= 3,
            "mount point should name a drive, got {:?}",
            info.mount_point
        );
    }

    /// The actual Room B case, against a real UNC path.
    ///
    /// `\\localhost\C$` is the same *kind* of thing as
    /// `\\research.drive.wisc.edu\niedenthal`: a share, which Windows reports
    /// as `DRIVE_REMOTE` and which `sysinfo` therefore never lists. The old
    /// implementation returned None here and the app read that as a full
    /// drive. Skipped rather than failed where the admin share is off, since
    /// that is a machine policy and not a bug in this code.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_unc_share_reports_real_free_space() {
        let unc = Path::new(r"\\localhost\C$");
        if !unc.is_dir() {
            eprintln!("skipped: no admin share on this machine");
            return;
        }

        // What the old code did, kept here as the control: sysinfo cannot see
        // a remote volume, so a prefix match over its list finds nothing.
        let visible_to_sysinfo = sysinfo::Disks::new_with_refreshed_list()
            .iter()
            .any(|d| unc.starts_with(d.mount_point()));
        assert!(
            !visible_to_sysinfo,
            "if sysinfo ever starts listing shares, this whole workaround can be revisited"
        );

        let info = disk_for_path(unc).expect("a reachable share reports its free space");
        assert!(info.total_bytes > 0, "a real share has a size");
        assert!(info.available_bytes > 0, "and free space this test can see");
        assert_eq!(info.mount_point, r"\\localhost\C$");
    }

    /// A folder the RA has picked but not yet created still sits on a volume.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_folder_that_does_not_exist_yet_still_resolves_to_its_drive() {
        let missing = std::env::temp_dir().join("labsuite-not-created-yet").join("deeper");
        let info = disk_for_path(&missing).expect("walks up to an existing ancestor");
        assert!(info.total_bytes > 0);
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
