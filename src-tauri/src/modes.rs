// One place owns every per-window behavior.
//
// The standalone apps both hardcoded the window label "main" — the recorder's
// WebView2 accelerator-key fix silently stopped applying if the label changed,
// and the PPS app outright unwrapped it. In the suite, windows are created
// here at runtime with explicit labels, the factory applies each mode's
// behavior to the handle it just created, and the close guards match on label.
// tauri.conf.json declares no windows at all.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::machine::Role;
use crate::recorder::capture::{RecorderState, SessionKind};
use crate::recorder::{commands, roundrobin};

pub const RECORDER_LABEL: &str = "recorder";
pub const STATION_LABEL: &str = "station";
pub const LAUNCHER_LABEL: &str = "launcher";

pub fn open_for_role(app: &AppHandle, role: Role) -> tauri::Result<()> {
    match role {
        Role::Record => {
            let window = WebviewWindowBuilder::new(
                app,
                RECORDER_LABEL,
                WebviewUrl::App("recorder.html".into()),
            )
            .title("Lab Recorder")
            .inner_size(1280.0, 880.0)
            .min_inner_size(960.0, 640.0)
            .center()
            .build()?;
            disable_browser_accelerator_keys(&window);

            // Anything left queued by a previous session — a network drop, a
            // Research Drive that was not mounted — gets another attempt as
            // soon as the recorder opens, without anyone having to remember.
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok((url, secret)) = commands::round_robin_credentials(&handle) {
                    if let Ok(report) = roundrobin::flush(&handle, &url, &secret).await {
                        if report.attempted > 0 {
                            let _ = handle.emit("registrations-flushed", &report);
                        }
                    }
                }
            });
        }
        Role::Station => {
            let window = WebviewWindowBuilder::new(
                app,
                STATION_LABEL,
                WebviewUrl::App("station.html".into()),
            )
            .title("PPS Study")
            .inner_size(1440.0, 900.0)
            .maximized(true)
            .build()?;
            disable_browser_accelerator_keys(&window);

            // Exactly the surface the standalone PPS app set up, applied only
            // when this machine is a rating station:
            // - the app-global fs scope its asset/file handling relies on
            //   (the real gate is the capability — only station.json grants
            //   fs:default — this is defense in depth);
            // - the OS-level researcher save-and-quit chord. Global shortcuts
            //   fire regardless of focus, which is why the in-page keydown
            //   fallback alone was not enough in the standalone app.
            {
                use tauri_plugin_fs::FsExt;
                let _ = app.fs_scope().allow_directory("/", false);
            }
            register_station_shortcuts(app);
        }
        // Phases 3-4 implement Control and the Setup wizard. Until then the
        // remaining roles land on the placeholder launcher page, which says
        // exactly that.
        Role::Control | Role::Setup => {
            let window = WebviewWindowBuilder::new(
                app,
                LAUNCHER_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("Niedenthal Lab Suite")
            .inner_size(900.0, 700.0)
            .center()
            .build()?;
            disable_browser_accelerator_keys(&window);
        }
    }
    Ok(())
}

/// Builder-level window-event hook, label-aware.
///
/// recorder: closing mid-take would kill FFmpeg without letting it finalize
/// the container — a lost session for the price of a stray click — so close
/// is blocked only while a recording runs.
/// station (phase 2): close always routes to the researcher save-and-quit
/// modal instead, because up to ~15 s of buffered slider samples would drop.
pub fn handle_window_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    match window.label() {
        RECORDER_LABEL => {
            let recording = window
                .app_handle()
                .state::<RecorderState>()
                .active
                .lock()
                .map(|slot| matches!(slot.as_ref().map(|s| s.kind), Some(SessionKind::Record)))
                .unwrap_or(false);
            if recording {
                api.prevent_close();
                let _ = window.emit("close-blocked", ());
            }
        }
        STATION_LABEL => {
            api.prevent_close();
            let _ = window.emit("admin-quit", ());
        }
        _ => {}
    }
}

/// Ctrl+Shift+Q (and Cmd+Shift+Q on the lab Mac): the researcher save-and-quit
/// gate. Registered only in Station mode — on a recorder machine the chord
/// would emit an admin-quit nothing listens for.
fn register_station_shortcuts(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
    // `mut` is only used on macOS, which adds the Cmd variant.
    #[allow(unused_mut)]
    let mut wanted = vec![(
        "ctrl+shift+q",
        Modifiers::CONTROL | Modifiers::SHIFT,
        Code::KeyQ,
    )];
    #[cfg(target_os = "macos")]
    wanted.push(("cmd+shift+q", Modifiers::SUPER | Modifiers::SHIFT, Code::KeyQ));
    for (name, modifiers, code) in wanted {
        let shortcut = Shortcut::new(Some(modifiers), code);
        if let Err(e) = app.global_shortcut().register(shortcut) {
            // Non-fatal: the station frontend keeps its in-page keydown
            // fallback for exactly this case.
            eprintln!("global shortcut ({name}) registration failed: {e}");
        }
    }
}

/// WebView2 ships with browser accelerator keys enabled: Ctrl+R, Ctrl+Shift+R,
/// and F5 all reload the webview, and JavaScript cannot preventDefault them.
/// A reload mid-take resets every piece of frontend state while FFmpeg keeps
/// recording — and Ctrl+Shift+R is the recorder's own discreet-mode unlock
/// chord. Off for every app-content window. (The Control window, phase 4, is
/// a plain browser on the Round Robin site and keeps them.)
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
fn disable_browser_accelerator_keys(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        let _ = window.with_webview(|webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows_core::Interface;
            let settings = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings());
            if let Ok(settings) = settings {
                if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
                }
            }
        });
    }
}
