// Station mode — everything that was the standalone PPS study app.
//
// The command surface in `commands` is frozen (names, signatures, file
// formats): the station frontend ships byte-identical with the standalone
// app, enforced by scripts/verify-station-parity.mjs. `remote` is the Round
// Robin client added 2026-08-13 and is ours to adapt.

pub mod commands;
pub mod remote;
