// Niedenthal Lab Suite — Niedenthal Emotions Lab, UW-Madison.
//
// One binary, one install, every lab machine. A per-machine role decides what
// this process is when it wakes up:
//
//   Record   — the Lab Recorder (conversation rooms). Phase 1, done.
//   Station  — the PPS study app (rating stations). Phase 2.
//   Control  — an embedded window on the Round Robin site. Phase 4.
//   Setup    — the first-run wizard. Phase 3.
//
// The Round Robin website itself stays a website; this app talks to it and,
// in Control mode, frames it. All commands from every mode live in the one
// invoke handler below — a command is inert unless a screen calls it, and the
// only cross-mode name collision (the settings pair) is resolved by the
// recorder_ prefix on the recorder side (the PPS names are frozen: its
// frontend ships byte-identical with the standalone app).

mod machine;
mod modes;
mod recorder;
mod shared;
mod station;

pub fn run() {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        // The handler is app-wide; which chords are *registered* depends on
        // the role (modes.rs). Ctrl+Shift+Q (researcher save-and-quit) exists
        // only in Station mode — a recorder machine never has an OS-global
        // quit chord pointed at it. Ctrl+Alt+Shift+L (machine setup) exists
        // in every role: on a Control machine, whose window is a remote page
        // with no IPC, it is deliberately the only way to reconfigure.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyQ)
                        || shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyQ)
                    {
                        let _ = app.emit("admin-quit", ());
                    }
                    if shortcut.matches(
                        Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT,
                        Code::KeyL,
                    ) {
                        modes::open_setup_window(app);
                    }
                })
                .build(),
        )
        .manage(recorder::capture::RecorderState::default())
        .setup(|app| {
            // Seed machine.json + recorder/station files from the standalone
            // apps' app-data the first time the suite runs on a lab machine.
            // Read-only toward the old apps: they stay working as fallback.
            machine::migrate_if_fresh(app.handle());
            // The machine-setup chord is registered once, here, for the whole
            // process — every mode keeps it, and on a Control machine (remote
            // page, no IPC) it is deliberately the only reconfigure path.
            modes::register_reconfigure_chord(app.handle());
            let role = machine::current_role(app.handle());
            modes::open_for_role(app.handle(), role)?;
            Ok(())
        })
        .on_window_event(modes::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            recorder::commands::list_devices,
            recorder::commands::probe_camera,
            recorder::commands::plan_capture,
            recorder::commands::recommend_mode,
            recorder::commands::ffmpeg_info,
            recorder::commands::start_preview,
            recorder::commands::stop_preview,
            recorder::commands::preview_frame,
            recorder::commands::start_recording,
            recorder::commands::stop_recording,
            recorder::commands::is_recording,
            recorder::commands::active_recording,
            recorder::commands::preflight,
            recorder::commands::finalize_recording,
            recorder::commands::find_orphaned_captures,
            recorder::commands::disk_space,
            recorder::commands::estimate_space,
            recorder::commands::profile_hash,
            recorder::commands::recorder_load_settings,
            recorder::commands::recorder_save_settings,
            recorder::commands::rr_sessions,
            recorder::commands::rr_open,
            recorder::commands::rr_pending,
            recorder::commands::rr_flush,
            recorder::commands::archive_recording,
            station::commands::write_csv_ratings,
            station::commands::write_csv_transitions,
            station::commands::setup_rating_directory,
            station::commands::exit_app,
            station::commands::load_roundrobin,
            station::commands::save_roundrobin,
            station::commands::load_settings,
            station::commands::save_settings,
            station::commands::load_progress,
            station::commands::save_progress,
            station::remote::remote_status,
            station::remote::remote_configure,
            station::remote::remote_test,
            station::remote::list_conversation_clips,
            station::remote::report_study_progress,
            station::remote::prepare_conversation_video,
            machine::machine_status,
            machine::machine_configure,
            machine::machine_test,
            machine::machine_health,
            machine::launch_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Niedenthal Lab Suite");
}
