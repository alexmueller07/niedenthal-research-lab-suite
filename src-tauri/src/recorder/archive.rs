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

use std::path::{Component, Path, PathBuf};

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

/// Resolves a server-supplied storage key against the local Research Drive root.
///
/// The key comes from Round Robin over the network, so it is treated as
/// untrusted input even though we generated the request that produced it. A key
/// containing `..` would otherwise write anywhere on the drive.
pub fn resolve_storage_path(root: &Path, storage_key: &str) -> Result<PathBuf, String> {
    if storage_key.trim().is_empty() {
        return Err("The storage key is empty.".into());
    }
    let relative = Path::new(storage_key);
    if relative.is_absolute() {
        return Err(format!("Storage key must be relative, got {storage_key}"));
    }
    for component in relative.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(format!(
                    "Storage key must not contain path traversal, got {storage_key}"
                ))
            }
        }
    }
    Ok(root.join(relative))
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
    fn joins_a_normal_storage_key_under_the_root() {
        let root = Path::new("Z:/round-robin/recordings");
        let path = resolve_storage_path(root, "slot-1/round-2/room-1-aaaa-bbbb.mp4").unwrap();
        assert!(path.ends_with("room-1-aaaa-bbbb.mp4"));
        assert!(path.starts_with(root));
    }

    #[test]
    fn refuses_traversal_out_of_the_root() {
        let root = Path::new("Z:/round-robin/recordings");
        assert!(resolve_storage_path(root, "../../etc/passwd").is_err());
        assert!(resolve_storage_path(root, "slot/../../escape.mp4").is_err());
    }

    #[test]
    fn refuses_an_absolute_key() {
        let root = Path::new("Z:/round-robin/recordings");
        assert!(resolve_storage_path(root, "/etc/passwd").is_err());
    }

    #[test]
    fn refuses_an_empty_key() {
        assert!(resolve_storage_path(Path::new("Z:/x"), "  ").is_err());
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
