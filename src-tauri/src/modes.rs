// One place owns every per-window behavior.
//
// The standalone apps both hardcoded the window label "main" — the recorder's
// WebView2 accelerator-key fix silently stopped applying if the label changed,
// and the PPS app outright unwrapped it. In the suite, windows are created
// here at runtime with explicit labels, the factory applies each mode's
// behavior to the handle it just created, and the close guards match on label.
// tauri.conf.json declares no windows at all.

use tauri::webview::Color;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Painted behind every app window before the webview first renders, so a
/// slow first paint shows the theme color instead of a white flash. Matches
/// the launcher/recorder dark background; the station is pure black anyway.
const DARK: Color = Color(14, 16, 19, 255);

/// The primary monitor's usable area — the screen minus the taskbar — in the
/// logical units the window builder takes.
fn work_area_logical(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    Some((
        f64::from(area.position.x) / scale,
        f64::from(area.position.y) / scale,
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    ))
}

/// No title bar, no border, filling the screen down to the taskbar.
///
/// The lab asked for the chrome to go (2026-08-29): a title bar above a
/// participant-facing task is one more thing to click by accident, and on the
/// station it is the only piece of the screen that is not the study.
///
/// Deliberately NOT `.fullscreen(true)`. Real fullscreen on Windows covers the
/// taskbar and makes Win+Ctrl+arrow desktop switching unreliable — and RAs
/// switch desktops between a session and their own work all day. Sizing to the
/// work area instead keeps the window a window: alt-tabbable, taskbar visible,
/// desktops switchable, just without a frame.
///
/// The fallback matters. A monitor query can fail (a session opening while the
/// display is asleep, a remote desktop mid-reconnect), and a chromeless window
/// at some default size with no title bar to drag would be genuinely stuck. So
/// no work area means a plain maximised window, which is always usable.
fn fill_screen<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
    app: &AppHandle,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    match work_area_logical(app) {
        Some((x, y, width, height)) => builder
            .decorations(false)
            .position(x, y)
            .inner_size(width, height),
        None => builder.maximized(true),
    }
}

use crate::machine::Role;
use crate::recorder::capture::{RecorderState, SessionKind};
use crate::recorder::{commands, roundrobin};

pub const RECORDER_LABEL: &str = "recorder";
pub const STATION_LABEL: &str = "station";
pub const LAUNCHER_LABEL: &str = "launcher";
pub const CONTROL_LABEL: &str = "control";

/// Every window that *is* a mode. The launcher is not one of them.
pub const MODE_LABELS: [&str; 3] = [RECORDER_LABEL, STATION_LABEL, CONTROL_LABEL];

/// Set once, just before the process exits, so the "a mode window closed —
/// show the chooser again" rule below does not fight an actual quit and
/// resurrect a window on the way out.
static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn begin_shutdown() {
    SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst)
}

/// The label of the mode window currently open, if any. One at a time is a
/// deliberate rule: a rating station quietly also being a recorder is exactly
/// the confusion this app exists to prevent.
pub fn running_mode_label(app: &AppHandle) -> Option<&'static str> {
    MODE_LABELS
        .into_iter()
        .find(|label| app.get_webview_window(label).is_some())
}

/// True while FFmpeg is mid-take. Closing anything then costs a session.
pub fn recording_in_progress(app: &AppHandle) -> bool {
    app.state::<RecorderState>()
        .active
        .lock()
        .map(|slot| matches!(slot.as_ref().map(|s| s.kind), Some(SessionKind::Record)))
        .unwrap_or(false)
}

/// Async because Control mode has to ask the server for a login token before
/// it knows where to point the window — and because creating a window from a
/// synchronous command deadlocks the Windows event loop (see launch_mode).
pub async fn open_for_role(app: &AppHandle, role: Role) -> tauri::Result<()> {
    let control_target: Option<String> = if role == Role::Control {
        Some(crate::machine::control_url(app).await)
    } else {
        None
    };
    match role {
        Role::Record => {
            let window = fill_screen(
                WebviewWindowBuilder::new(
                    app,
                    RECORDER_LABEL,
                    WebviewUrl::App("recorder.html".into()),
                )
                .title("Lab Recorder")
                .background_color(DARK)
                .min_inner_size(960.0, 640.0),
                app,
            )
            .build()?;
            disable_browser_accelerator_keys(&window);

            // Anything left queued by a previous session — a network drop, a
            // Research Drive that was not mounted — gets another attempt as
            // soon as the recorder opens, without anyone having to remember.
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let (url, secret) = commands::round_robin_credentials(&handle);
                if let Ok(report) = roundrobin::flush(&handle, &url, &secret).await {
                    if report.attempted > 0 {
                        let _ = handle.emit("registrations-flushed", &report);
                    }
                }
            });
        }
        Role::Station => {
            let window = fill_screen(
                WebviewWindowBuilder::new(
                    app,
                    STATION_LABEL,
                    WebviewUrl::App("station.html".into()),
                )
                .title("PPS Study")
                .background_color(DARK),
                app,
            )
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
        Role::Control => {
            // A plain browsing window on the Round Robin site's ADMIN pages.
            // Straight to /admin, not the site root: the root is the
            // participant portal, which participants reach from home through
            // their emailed links — an RA opening Control mode in the lab
            // wants the session dashboard, every time. (The admin password
            // prompt appears on first use; the login cookie then holds for
            // the shift.) Deliberately no capability targets this label and
            // no capability lists a remote origin, so the page gets zero IPC
            // — it is exactly the website, framed. Accelerator keys stay
            // enabled here: F5 on a website is normal life, and there is no
            // app state to lose.
            // control_url mints a one-minute login token from the shared
            // secret so the dashboard opens with no password typed; it
            // returns the plain /admin URL if that cannot be done, and an
            // empty string when the machine has no server configured.
            let resolved = control_target.unwrap_or_default();
            let Some(url) = Some(resolved)
                .filter(|u: &String| !u.trim().is_empty())
                .and_then(|u| tauri::Url::parse(&u).ok())
            else {
                // No usable server address: fall back to setup, which says
                // what is missing.
                open_setup_window(app);
                return Ok(());
            };
            WebviewWindowBuilder::new(app, CONTROL_LABEL, WebviewUrl::External(url))
                .title("Round Robin — Control Center")
                .inner_size(1440.0, 900.0)
                .maximized(true)
                .build()?;
        }
        Role::Setup => {
            open_setup_window(app);
        }
    }
    Ok(())
}

/// Leaves the mode running in `window` and goes somewhere else — another mode,
/// or the chooser.
///
/// The lab's first walkthrough of the suite (Alex, 2026-08-22) got stuck here:
/// entering a mode was a one-way door, and the only way back to the chooser
/// was to quit the app and start it again. New RAs hit that on their first
/// morning. Both directions now exist, and every route into this function has
/// already flushed whatever the mode was holding.
///
/// Order matters: the destination window is created *before* the old one is
/// destroyed. Destroying the last window on Windows starts the process
/// shutting down, and a window created after that races the exit.
pub async fn leave_mode(app: &AppHandle, window: &WebviewWindow, to: Option<Role>) -> tauri::Result<()> {
    match to {
        Some(role) => open_for_role(app, role).await?,
        None => open_setup_window(app),
    }
    // destroy(), not close(): close() raises CloseRequested, which the station
    // deliberately intercepts to open its save-and-quit modal — the caller has
    // already saved, so that would be a loop with a dialog in it.
    window.destroy()
}

/// Opens (or focuses) the setup/launcher window. Called at boot for an
/// unconfigured machine and from the Ctrl+Alt+Shift+L chord in every role.
pub fn open_setup_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(LAUNCHER_LABEL) {
        let _ = existing.set_focus();
        return;
    }
    let built = fill_screen(
        WebviewWindowBuilder::new(
            app,
            LAUNCHER_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .title("Niedenthal Lab Suite")
        .background_color(DARK),
        app,
    )
    .build();
    match built {
        Ok(window) => disable_browser_accelerator_keys(&window),
        Err(e) => eprintln!("could not open the setup window: {e}"),
    }
}

/// Ctrl+Alt+Shift+L — chosen to collide with neither of the modes' existing
/// chords (station Ctrl+Shift+Q save-and-quit, recorder Ctrl+Shift+R discreet
/// unlock). Registered once at startup (lib.rs). Registration failure is
/// logged, not fatal: the chooser still opens on every fresh launch.
pub fn register_reconfigure_chord(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
    let chord = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyL,
    );
    if let Err(e) = app.global_shortcut().register(chord) {
        eprintln!("machine-setup chord registration failed: {e}");
    }
}

/// Builder-level window-event hook, label-aware.
///
/// recorder: closing mid-take would kill FFmpeg without letting it finalize
/// the container — a lost session for the price of a stray click — so close
/// is blocked only while a recording runs.
/// station (phase 2): close always routes to the researcher save-and-quit
/// modal instead, because up to ~15 s of buffered slider samples would drop.
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        handle_window_destroyed(window);
        return;
    }
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    match window.label() {
        RECORDER_LABEL => {
            if recording_in_progress(window.app_handle()) {
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

/// True when the window that closed most recently was a mode rather than the
/// chooser. Read once, at exit time, to decide between "go back to the chooser"
/// and "this really is the end of the session".
static LAST_CLOSED_WAS_MODE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// A window went away. Remember which kind it was, and bring the chooser
/// forward if it is already open.
///
/// This is the other half of the one-way-door fix: closing a mode with the X
/// used to end the session outright, and the way back to a different mode was
/// to launch the app again. Now it lands where every launch lands.
///
/// Creating the chooser is NOT done here. On Windows, a window created inside
/// a window-event callback deadlocks the event loop, and closing the last
/// window starts the process exiting anyway — so the reopen belongs in the
/// exit handler below, which can call off the exit first.
pub fn handle_window_destroyed(window: &tauri::Window) {
    let label = window.label();
    if MODE_LABELS.contains(&label) {
        LAST_CLOSED_WAS_MODE.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(launcher) = window.app_handle().get_webview_window(LAUNCHER_LABEL) {
            let _ = launcher.set_focus();
        }
    } else if label == LAUNCHER_LABEL {
        LAST_CLOSED_WAS_MODE.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// The last window has gone and the process is about to end. Should it?
///
/// Yes when the chooser itself was closed, or something asked for a real quit
/// (the researcher save-and-quit gate, the chooser's Quit button). No when a
/// mode window was closed — that is an RA finishing one job, and the next
/// thing they want is the screen that starts another.
pub fn handle_exit_requested(app: &AppHandle) -> bool {
    if is_shutting_down() {
        return true;
    }
    if !LAST_CLOSED_WAS_MODE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return true;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        open_setup_window(&handle);
    });
    false
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
