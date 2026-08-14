// Shared plumbing both modes were carrying their own copies of when they were
// separate apps. Kept deliberately small: only code whose behavior is
// provably identical on both sides moves here. RA-facing error strings and
// the two verified-copy routines (the recorder's copy-then-re-read-and-hash
// for the Research Drive, the station's hash-while-copying with progress
// events) stay in their modules — their differences are load-bearing.

pub mod hashing;
pub mod http;
