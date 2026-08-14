// The one SHA-256 file hash. The recorder checksums a finished take before
// filing it; the station re-checks the same checksum after fetching the take
// back off the Research Drive. Both ends of that chain calling the same
// function is the point.

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

pub fn file_sha256(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("could not open {} for checksumming: {e}", path.display()))?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_deterministic_and_lowercase_hex() {
        let dir = std::env::temp_dir().join(format!("suite-hash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("take.mp4");
        std::fs::write(&file, b"some recorded bytes").unwrap();

        let first = file_sha256(&file).unwrap();
        let second = file_sha256(&file).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

        std::fs::remove_dir_all(&dir).ok();
    }
}
