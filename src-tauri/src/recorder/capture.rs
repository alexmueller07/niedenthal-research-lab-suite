// The recording session: spawn FFmpeg, follow what it reports, stop it cleanly.
//
// Two things here are not ordinary process management.
//
// First, stopping. FFmpeg is asked to stop by writing "q" to its stdin, never by
// a kill signal. A killed process leaves the container unfinalized — for MP4
// that means no moov atom, which means an unplayable file and a lost session.
// Killing is the escalation path after a timeout, not the mechanism.
//
// Second, the drop and duplicate counters. `-progress` reports how many frames
// FFmpeg had to invent or discard to hold constant frame rate. That number is a
// data-quality measurement, so it is surfaced live, kept after the fact, and
// written into the manifest — not logged and forgotten.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::recorder::ffmpeg::{
    build_preview_args, build_record_args, CaptureBackend, ContainerStrategy, OutputPaths,
    RecordSettings,
};

/// How long a graceful stop is allowed to take before we escalate to a kill.
/// Finalizing a ten-minute MP4 is fast; this is generous on purpose because the
/// alternative to waiting is losing the take.
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    /// Setup-screen preview. No file output, disposable.
    Preview,
    /// A real take.
    Record,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub frames: u64,
    pub fps: f64,
    pub dropped_frames: u64,
    pub duplicated_frames: u64,
    pub bytes: u64,
    pub out_time_us: u64,
    pub bitrate_kbps: f64,
    /// FFmpeg's own encode speed multiplier. Below 1.0 means the encoder is not
    /// keeping up with the camera, which is the leading indicator of drops.
    pub speed: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    /// Momentary loudness, LUFS. Around -60 or lower means effectively silent.
    pub momentary_lufs: f64,
    pub peak_dbfs: f64,
}

/// State shared between the FFmpeg output reader and everything else.
#[derive(Default)]
pub struct SessionShared {
    pub finished: AtomicBool,
    pub exit_code: Mutex<Option<i32>>,
    pub progress: Mutex<ProgressSnapshot>,
    pub audio: Mutex<AudioLevel>,
    /// Last N stderr lines. Kept bounded — a long session produces a lot of
    /// output and none of it is worth unbounded memory.
    pub stderr_tail: Mutex<VecDeque<String>>,
}

impl SessionShared {
    pub fn push_stderr(&self, line: String) {
        if let Ok(mut tail) = self.stderr_tail.lock() {
            if tail.len() >= 400 {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    }

    pub fn stderr_text(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    }
}

pub struct ActiveSession {
    pub kind: SessionKind,
    pub child: Option<CommandChild>,
    pub shared: Arc<SessionShared>,
    pub started_at: DateTime<Utc>,
    pub started_instant: Instant,
    pub capture_path: Option<PathBuf>,
    pub preview_path: PathBuf,
    pub settings: RecordSettings,
}

#[derive(Default)]
pub struct RecorderState {
    pub active: Mutex<Option<ActiveSession>>,
    /// Whatever the frontend needs to rebuild its recording screen after the
    /// webview reloads mid-take. Opaque JSON — Rust never reads it.
    pub record_context: Mutex<Option<serde_json::Value>>,
}

// ---------------------------------------------------------------------------
// Parsing — pure and tested
// ---------------------------------------------------------------------------

/// Accumulates `-progress` key=value lines into snapshots.
///
/// FFmpeg emits a block of keys and terminates it with `progress=continue` or
/// `progress=end`. Reading keys as they arrive without waiting for that
/// terminator produces snapshots that mix two different instants.
#[derive(Default)]
pub struct ProgressAccumulator {
    fields: HashMap<String, String>,
}

impl ProgressAccumulator {
    /// Feeds one line. Returns a snapshot only when a block completes.
    pub fn push(&mut self, line: &str) -> Option<ProgressSnapshot> {
        let line = line.trim();
        let (key, value) = line.split_once('=')?;
        let key = key.trim().to_string();
        let value = value.trim().to_string();

        if key == "progress" {
            let snap = self.snapshot();
            self.fields.clear();
            return Some(snap);
        }
        self.fields.insert(key, value);
        None
    }

    fn num<T: std::str::FromStr + Default>(&self, key: &str) -> T {
        self.fields
            .get(key)
            .and_then(|v| v.parse::<T>().ok())
            .unwrap_or_default()
    }

    fn snapshot(&self) -> ProgressSnapshot {
        // FFmpeg writes "N/A" for these before the first frame lands, and
        // suffixes units on others ("11996.4kbits/s", "1.02x").
        let strip = |key: &str, suffix: &str| -> f64 {
            self.fields
                .get(key)
                .map(|v| v.trim_end_matches(suffix))
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0)
        };
        ProgressSnapshot {
            frames: self.num("frame"),
            fps: self.num("fps"),
            dropped_frames: self.num("drop_frames"),
            duplicated_frames: self.num("dup_frames"),
            bytes: self.num("total_size"),
            out_time_us: self.num("out_time_us"),
            bitrate_kbps: strip("bitrate", "kbits/s"),
            speed: strip("speed", "x"),
        }
    }
}

/// Reads a level out of one ebur128 stderr line.
///
/// The meter is driven by the real capture graph rather than a separate Web
/// Audio tap, so a moving meter is evidence that the audio being *recorded* is
/// live — not merely that some microphone somewhere is.
pub fn parse_ebur128_line(line: &str) -> Option<AudioLevel> {
    if !line.contains("M:") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let value_after = |label: &str| -> Option<f64> {
        let i = tokens.iter().position(|t| *t == label)?;
        let raw = tokens.get(i + 1)?;
        if raw.starts_with("-inf") {
            return Some(-120.0);
        }
        raw.parse::<f64>().ok()
    };
    let momentary = value_after("M:")?;
    Some(AudioLevel {
        momentary_lufs: momentary,
        peak_dbfs: value_after("FTPK:").unwrap_or(-120.0),
    })
}

/// Whether an FFmpeg stderr line is worth showing a human.
///
/// FFmpeg is chatty and most of it is noise, but a handful of lines are the
/// difference between "the recording is fine" and "the camera stopped feeding".
pub fn is_noteworthy(line: &str) -> bool {
    let l = line.to_ascii_lowercase();
    l.contains("error")
        || l.contains("could not")
        || l.contains("unable to")
        || l.contains("invalid")
        || l.contains("no such")
        || l.contains("permission")
        || l.contains("real-time buffer")
        || l.contains("frame dropped")
        || l.contains("past duration")
        || l.contains("not enough")
}

/// A JPEG is only safe to hand to the webview once its end-of-image marker has
/// landed. FFmpeg rewrites the preview file in place, so a naive read catches a
/// torn frame roughly as often as not.
pub fn jpeg_is_complete(bytes: &[u8]) -> bool {
    bytes.len() > 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes.ends_with(&[0xFF, 0xD9])
}

// ---------------------------------------------------------------------------
// Session control
// ---------------------------------------------------------------------------

fn preview_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("preview.jpg")
}

/// Spawns FFmpeg and wires its output to app events.
fn spawn_session(
    app: &AppHandle,
    kind: SessionKind,
    args: Vec<String>,
    settings: RecordSettings,
    capture_path: Option<PathBuf>,
    preview: PathBuf,
) -> Result<(), String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar is missing — run `npm run ffmpeg` ({e})"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("could not start FFmpeg: {e}"))?;

    let shared = Arc::new(SessionShared::default());
    let reader_shared = Arc::clone(&shared);
    let reader_app = app.clone();

    tauri::async_runtime::spawn(async move {
        let mut progress = ProgressAccumulator::default();
        let mut last_emit = Instant::now() - Duration::from_secs(1);

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    for line in text.lines() {
                        if let Some(snap) = progress.push(line) {
                            if let Ok(mut slot) = reader_shared.progress.lock() {
                                *slot = snap.clone();
                            }
                            // FFmpeg emits progress blocks faster than any UI
                            // needs; throttle to a readable rate.
                            if last_emit.elapsed() >= Duration::from_millis(200) {
                                last_emit = Instant::now();
                                let _ = reader_app.emit("recording-progress", &snap);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    for line in text.lines() {
                        if let Some(level) = parse_ebur128_line(line) {
                            if let Ok(mut slot) = reader_shared.audio.lock() {
                                *slot = level.clone();
                            }
                            let _ = reader_app.emit("recording-audio", &level);
                            continue;
                        }
                        reader_shared.push_stderr(line.to_string());
                        if is_noteworthy(line) {
                            let _ = reader_app.emit("recording-warning", line.to_string());
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Ok(mut code) = reader_shared.exit_code.lock() {
                        *code = payload.code;
                    }
                    reader_shared.finished.store(true, Ordering::SeqCst);
                    // Only a RECORD session announces its end. A preview exit
                    // firing this event could arrive at the webview a beat
                    // after a take began, and the frontend's died-mid-take
                    // handler would then stop the brand-new recording — the
                    // same race stop_any closed, through a different door.
                    if kind == SessionKind::Record {
                        let _ = reader_app.emit("recording-finished", payload.code);
                    }
                }
                CommandEvent::Error(err) => {
                    reader_shared.push_stderr(format!("process error: {err}"));
                    reader_shared.finished.store(true, Ordering::SeqCst);
                    let _ = reader_app.emit("recording-warning", err);
                }
                _ => {}
            }
        }
        reader_shared.finished.store(true, Ordering::SeqCst);
    });

    let state = app.state::<RecorderState>();
    let mut slot = state.active.lock().map_err(|_| "recorder state is poisoned")?;
    *slot = Some(ActiveSession {
        kind,
        child: Some(child),
        shared,
        started_at: Utc::now(),
        started_instant: Instant::now(),
        capture_path,
        preview_path: preview,
        settings,
    });
    Ok(())
}

pub fn start_preview(app: &AppHandle, settings: RecordSettings) -> Result<(), String> {
    stop_any(app)?;
    let preview = preview_path(app);
    let _ = std::fs::remove_file(&preview);
    let args = build_preview_args(
        CaptureBackend::current(),
        &settings,
        &preview.to_string_lossy(),
    );
    spawn_session(app, SessionKind::Preview, args, settings, None, preview)
}

/// Starts a take. `capture_path` is where FFmpeg writes during the session —
/// the .mkv under the crash-safe strategy, the final .mp4 otherwise.
pub fn start_recording(
    app: &AppHandle,
    settings: RecordSettings,
    capture_path: PathBuf,
) -> Result<(), String> {
    // Any preview is still holding the camera. On Windows a DirectShow device
    // is usually exclusive-access, so this is not tidiness — the record spawn
    // fails outright if the preview is still attached.
    stop_any(app)?;

    if let Some(parent) = capture_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }

    let preview = preview_path(app);
    let _ = std::fs::remove_file(&preview);
    let paths = OutputPaths {
        capture: capture_path.to_string_lossy().to_string(),
        preview: preview.to_string_lossy().to_string(),
    };
    let args = build_record_args(CaptureBackend::current(), &settings, &paths);
    spawn_session(
        app,
        SessionKind::Record,
        args,
        settings,
        Some(capture_path),
        preview,
    )
}

/// Result of finishing a take, before verification runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopOutcome {
    pub capture_path: String,
    pub started_at: String,
    pub ended_at: String,
    pub wall_duration_ms: u64,
    pub progress: ProgressSnapshot,
    pub exit_code: Option<i32>,
    /// True when the graceful stop timed out and the process had to be killed —
    /// which puts the resulting file's integrity in doubt.
    pub forced: bool,
    pub stderr_tail: String,
    pub container: ContainerStrategy,
}

/// Stops the preview if one is running. A live RECORD session is deliberately
/// untouchable from here: this is what the webview's stop_preview command and
/// the preflight teardown call, and a React effect cleanup firing one beat
/// after a take started must not be able to kill it. It could, and did —
/// every recording died at ~19 frames because the setup screen's preview
/// cleanup ran right after the phase flipped to recording (2026-08-17).
/// Ending a take goes through stop_recording, which returns the outcome the
/// finalize step needs; nothing else may end one.
pub fn stop_any(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let taken = {
        let mut slot = state.active.lock().map_err(|_| "recorder state is poisoned")?;
        if matches!(slot.as_ref().map(|s| s.kind), Some(SessionKind::Record)) {
            return Ok(());
        }
        slot.take()
    };
    let Some(mut session) = taken else { return Ok(()) };
    let Some(mut child) = session.child.take() else { return Ok(()) };

    let _ = child.write(b"q\n");
    let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
    while !session.shared.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if !session.shared.finished.load(Ordering::SeqCst) {
        let _ = child.kill();
    }
    Ok(())
}

/// Stops an active take and reports what happened.
pub fn stop_recording(app: &AppHandle) -> Result<StopOutcome, String> {
    let state = app.state::<RecorderState>();
    let taken = {
        let mut slot = state.active.lock().map_err(|_| "recorder state is poisoned")?;
        slot.take()
    };
    let Some(mut session) = taken else {
        return Err("Nothing is recording.".into());
    };
    if session.kind != SessionKind::Record {
        return Err("The preview is running, not a recording.".into());
    }

    let mut forced = false;
    if let Some(mut child) = session.child.take() {
        // "q" on stdin, not a signal. This is what makes FFmpeg write the
        // container's index and trailer instead of leaving a truncated file.
        child
            .write(b"q\n")
            .map_err(|e| format!("could not signal FFmpeg to stop: {e}"))?;

        let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
        while !session.shared.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        if !session.shared.finished.load(Ordering::SeqCst) {
            let _ = child.kill();
            forced = true;
            std::thread::sleep(Duration::from_millis(300));
        }
    }

    let progress = session
        .shared
        .progress
        .lock()
        .map(|p| p.clone())
        .unwrap_or_default();
    let exit_code = session.shared.exit_code.lock().ok().and_then(|c| *c);

    Ok(StopOutcome {
        capture_path: session
            .capture_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        started_at: session.started_at.to_rfc3339(),
        ended_at: Utc::now().to_rfc3339(),
        wall_duration_ms: session.started_instant.elapsed().as_millis() as u64,
        progress,
        exit_code,
        forced,
        stderr_tail: session.shared.stderr_text(),
        container: session.settings.container,
    })
}

/// A preview frame older than this means the camera has stopped delivering.
/// FFmpeg rewrites the same path in place, so without a freshness check a
/// stalled camera keeps showing its last good frame indefinitely — the UI would
/// look healthy while nothing was being recorded.
const PREVIEW_STALE_AFTER: Duration = Duration::from_secs(2);

/// Current preview frame, or None when there is not a fresh complete one.
pub fn read_preview_frame(app: &AppHandle) -> Option<Vec<u8>> {
    let path = {
        let state = app.state::<RecorderState>();
        let slot = state.active.lock().ok()?;
        slot.as_ref()?.preview_path.clone()
    };
    let age = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()?
        .elapsed()
        .unwrap_or_default();
    if age > PREVIEW_STALE_AFTER {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    jpeg_is_complete(&bytes).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_block_yields_one_snapshot_at_its_terminator() {
        let mut acc = ProgressAccumulator::default();
        let block = [
            "frame=150",
            "fps=30.00",
            "bitrate=11996.4kbits/s",
            "total_size=1500000",
            "out_time_us=5000000",
            "dup_frames=2",
            "drop_frames=7",
            "speed=1.02x",
        ];
        for line in block {
            assert!(acc.push(line).is_none(), "no snapshot before the terminator");
        }
        let snap = acc.push("progress=continue").expect("terminator yields a snapshot");
        assert_eq!(snap.frames, 150);
        assert_eq!(snap.dropped_frames, 7);
        assert_eq!(snap.duplicated_frames, 2);
        assert_eq!(snap.bytes, 1_500_000);
        assert_eq!(snap.out_time_us, 5_000_000);
        assert!((snap.bitrate_kbps - 11996.4).abs() < 0.01);
        assert!((snap.speed - 1.02).abs() < 0.001);
    }

    #[test]
    fn accumulator_resets_between_blocks() {
        let mut acc = ProgressAccumulator::default();
        acc.push("frame=10");
        acc.push("progress=continue");
        acc.push("fps=30.0");
        let second = acc.push("progress=end").unwrap();
        assert_eq!(second.frames, 0, "stale frame count must not leak forward");
    }

    #[test]
    fn survives_the_na_values_ffmpeg_emits_before_the_first_frame() {
        let mut acc = ProgressAccumulator::default();
        acc.push("frame=0");
        acc.push("bitrate=N/A");
        acc.push("speed=N/A");
        acc.push("total_size=N/A");
        let snap = acc.push("progress=continue").unwrap();
        assert_eq!(snap.bitrate_kbps, 0.0);
        assert_eq!(snap.speed, 0.0);
        assert_eq!(snap.bytes, 0);
    }

    #[test]
    fn ignores_lines_that_are_not_key_values() {
        let mut acc = ProgressAccumulator::default();
        assert!(acc.push("this is not progress output").is_none());
        assert!(acc.push("").is_none());
    }

    #[test]
    fn reads_momentary_loudness_and_peak() {
        let line = "[Parsed_ebur128_0 @ 0x55] t: 1.4     M: -22.6 S: -22.6     I: -22.6 LUFS     LRA:   0.0 LU  FTPK: -12.4 -12.4 dBFS  TPK: -12.4 -12.4 dBFS";
        let level = parse_ebur128_line(line).unwrap();
        assert!((level.momentary_lufs + 22.6).abs() < 0.01);
        assert!((level.peak_dbfs + 12.4).abs() < 0.01);
    }

    #[test]
    fn silence_reads_as_a_floor_not_a_parse_failure() {
        // A muted microphone is the single most common way a session is lost,
        // so this must produce a number the meter can render, not a None.
        let line = "[Parsed_ebur128_0 @ 0x55] t: 0.4 M: -inf S: -inf I: -inf LUFS LRA: 0.0 LU FTPK: -inf -inf dBFS";
        let level = parse_ebur128_line(line).unwrap();
        assert_eq!(level.momentary_lufs, -120.0);
    }

    #[test]
    fn non_meter_lines_are_not_mistaken_for_levels() {
        assert!(parse_ebur128_line("frame=  120 fps=30").is_none());
    }

    #[test]
    fn flags_the_stderr_lines_that_actually_matter() {
        assert!(is_noteworthy("[dshow] real-time buffer too full, frame dropped!"));
        assert!(is_noteworthy("Could not open video device"));
        assert!(is_noteworthy("Error opening input file"));
        assert!(!is_noteworthy("Stream mapping:"));
        assert!(!is_noteworthy("  libavutil      59.  8.100"));
    }

    #[test]
    fn torn_preview_frames_are_rejected() {
        assert!(jpeg_is_complete(&[0xFF, 0xD8, 0x00, 0x11, 0xFF, 0xD9]));
        // Truncated mid-write — exactly what a naive read catches.
        assert!(!jpeg_is_complete(&[0xFF, 0xD8, 0x00, 0x11]));
        assert!(!jpeg_is_complete(&[]));
        assert!(!jpeg_is_complete(&[0x00, 0x01, 0xFF, 0xD9]));
    }
}
