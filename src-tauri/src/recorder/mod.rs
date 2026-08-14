// Record mode — everything that was the standalone Lab Recorder.
//
// The module boundary is the app boundary it used to have: nothing outside
// this tree reaches into capture internals, and the suite shell (lib.rs,
// modes.rs) touches only `commands`, `capture::RecorderState`, and
// `roundrobin::flush`.

pub mod archive;
pub mod capture;
pub mod commands;
pub mod devices;
pub mod disk;
pub mod ffmpeg;
pub mod manifest;
pub mod probe;
pub mod roundrobin;
pub mod settings;
