// Getting the finished file onto the Research Drive, provably intact.
//
// Recording writes to local disk first, on purpose: an SMB latency spike during
// a conversation stalls the writer, FFmpeg's input buffer overruns, and those
// frames are gone for good. The network hop happens afterwards, where a stall
// costs nothing but time.
//
// "Copied" is not the same as "arrived". A copy over SMB can truncate, and the
// failure looks exactly like success to std::fs::copy. So the destination is
// re-read and re-hashed, and the file only takes its final name once the hash
// matches what was computed locally.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::recorder::manifest::file_sha256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOutcome {
    pub destination: String,
    pub bytes: u64,
    /// True only when the destination was re-read and its hash matched.
    pub verified: bool,
    pub sha256: String,
}

/// The dyad number as every part of the pipeline spells it: digits only,
/// padded to three. The recording room types it, the Research Drive is
/// organised by it, and a rating station looks a conversation up with it — so
/// 14, 014 and "dyad-014-room2" all have to land on the same answer.
///
/// The FIRST run of digits, not all of them: RAs typed `dyad-014-room2` into
/// the field this replaced, and reading that as 0142 would file a conversation
/// under a dyad nobody will ever look for. Mirrors normalizeDyadId in
/// src/recorder/naming.ts, and the tests below are the same cases.
pub fn normalize_dyad_id(raw: &str) -> String {
    let digits: String = raw
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return String::new();
    }
    let trimmed = digits.trim_start_matches('0');
    let trimmed = if trimmed.is_empty() { "0" } else { trimmed };
    format!("{trimmed:0>3}")
}

/// `dyad-014` — the folder on the Research Drive a take is filed into, and the
/// folder a rating station reads it back out of. A take with no dyad number
/// still goes somewhere findable rather than nowhere.
pub fn dyad_folder(dyad_id: &str) -> String {
    let id = normalize_dyad_id(dyad_id);
    if id.is_empty() {
        "unfiled".to_string()
    } else {
        format!("dyad-{id}")
    }
}

/// Where a finished take belongs on the Research Drive.
///
/// Built here rather than handed down by a server. That is the whole point of
/// the dyad number: the recording room and the rating station can each work
/// out the same path from the same three digits, with nothing in between them
/// that can be down, out of date, or asked the wrong question.
///
/// The filename is taken from the local file, and it already carries a
/// timestamp (see fileStem), so two takes of one dyad cannot overwrite each
/// other.
pub fn dyad_destination(root: &Path, dyad_id: &str, local_file: &Path) -> Result<PathBuf, String> {
    let name = local_file
        .file_name()
        .ok_or_else(|| format!("{} has no filename.", local_file.display()))?;
    Ok(root.join(dyad_folder(dyad_id)).join(name))
}

/// Copies a file to the Research Drive and proves it arrived byte for byte.
///
/// The copy lands under a `.partial` name and is renamed only after its hash is
/// confirmed, so the destination path never exists in a half-written state — a
/// later process listing the drive cannot mistake an interrupted copy for a
/// finished recording.
pub fn copy_verified(
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<ArchiveOutcome, String> {
    if !source.exists() {
        return Err(format!("Nothing to copy — {} is missing.", source.display()));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| format!("{} has no parent directory.", destination.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| {
        format!(
            "Could not create {} on the Research Drive: {e}. Is the share mounted?",
            parent.display()
        )
    })?;

    let staging = destination.with_extension("partial");
    let _ = std::fs::remove_file(&staging);

    let bytes = std::fs::copy(source, &staging)
        .map_err(|e| format!("Copy to {} failed: {e}", staging.display()))?;

    let arrived = file_sha256(&staging).map_err(|e| {
        let _ = std::fs::remove_file(&staging);
        e
    })?;

    if arrived != expected_sha256 {
        // A mismatch means the bytes on the drive are not the bytes we recorded.
        // Leaving that file in place would be worse than having none.
        let _ = std::fs::remove_file(&staging);
        return Err(format!(
            "The copy on the Research Drive does not match the local file (expected {}, got {}). \
             Nothing was left behind; the local recording is untouched.",
            &expected_sha256[..12.min(expected_sha256.len())],
            &arrived[..12.min(arrived.len())]
        ));
    }

    let _ = std::fs::remove_file(destination);
    std::fs::rename(&staging, destination).map_err(|e| {
        format!(
            "Verified copy could not be renamed into place at {}: {e}",
            destination.display()
        )
    })?;

    Ok(ArchiveOutcome {
        destination: destination.to_string_lossy().to_string(),
        bytes,
        verified: true,
        sha256: arrived,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dyad_number_is_the_same_dyad_however_it_was_typed() {
        assert_eq!(normalize_dyad_id("14"), "014");
        assert_eq!(normalize_dyad_id("014"), "014");
        assert_eq!(normalize_dyad_id("  14  "), "014");
        assert_eq!(normalize_dyad_id("#7"), "007");
    }

    #[test]
    fn the_old_free_text_code_still_reads_as_its_dyad() {
        // "dyad-014-room2" is dyad 14 in room 2, not dyad 142.
        assert_eq!(normalize_dyad_id("dyad-014-room2"), "014");
        assert_eq!(normalize_dyad_id("dyad 14"), "014");
    }

    #[test]
    fn a_lab_that_gets_past_dyad_999_is_not_truncated() {
        assert_eq!(normalize_dyad_id("1042"), "1042");
    }

    #[test]
    fn nothing_numeric_is_not_a_dyad() {
        assert_eq!(normalize_dyad_id(""), "");
        assert_eq!(normalize_dyad_id("pilot"), "");
        assert_eq!(dyad_folder("pilot"), "unfiled");
    }

    #[test]
    fn both_ends_of_the_pipeline_build_the_same_path() {
        // This is the whole linkage: the recording room writes here, the
        // rating station reads here, and neither asks anyone.
        let root = Path::new("R:/niedenthal/recordings");
        let written = dyad_destination(root, "14", Path::new("D:/captures/dyad-014_20260924-140312.mp4")).unwrap();
        assert!(written.ends_with("dyad-014/dyad-014_20260924-140312.mp4"), "{written:?}");
        assert_eq!(dyad_folder("014"), "dyad-014");
    }

    #[test]
    fn copies_and_verifies_a_real_file() {
        let dir = std::env::temp_dir().join(format!("labrec-archive-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("take.mp4");
        std::fs::write(&src, b"some recorded bytes").unwrap();
        let expected = file_sha256(&src).unwrap();

        let dest = dir.join("drive/slot/room-1.mp4");
        let outcome = copy_verified(&src, &dest, &expected).unwrap();

        assert!(outcome.verified);
        assert_eq!(outcome.sha256, expected);
        assert_eq!(std::fs::read(&dest).unwrap(), b"some recorded bytes");
        assert!(!dest.with_extension("partial").exists(), "staging file left behind");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_hash_mismatch_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("labrec-archive-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("take.mp4");
        std::fs::write(&src, b"some recorded bytes").unwrap();

        let dest = dir.join("drive/room-1.mp4");
        let err = copy_verified(&src, &dest, &"0".repeat(64)).unwrap_err();

        assert!(err.contains("does not match"));
        assert!(!dest.exists(), "a file that failed verification must not be left in place");
        assert!(!dest.with_extension("partial").exists());
        assert!(src.exists(), "the local recording must never be touched");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_source_is_reported_clearly() {
        let err = copy_verified(
            Path::new("definitely-not-here.mp4"),
            Path::new("also-not-here.mp4"),
            "abc",
        )
        .unwrap_err();
        assert!(err.contains("Nothing to copy"));
    }
}
