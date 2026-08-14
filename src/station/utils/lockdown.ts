// In-app keyboard guard.
//
// Returns true when a keydown event is a browser shortcut that would damage a
// running session — reload, dev tools, history navigation, zoom — and that the
// webview is able to intercept. The App-level capture listener calls
// preventDefault on these.
//
// SCOPE — this is a data-safety guard, not a kiosk lock. Since 2026-08-04 the
// window is an ordinary window (minimize, resize, switch desktops); see
// src-tauri/src/lib.rs. Nothing here tries to keep the participant inside the
// app, and it never could: a webview cannot suppress OS-shell gestures
// (Alt+Tab, the Windows key, Win+Tab, Win+D, Ctrl+Alt+Del) because the shell
// handles them first. What it does prevent is a stray Ctrl+R or F5 wiping the
// in-memory state of a session that is halfway through.
//
// Note: plain Tab and Space are deliberately NOT blocked — the study uses Tab to
// submit ratings and Space to advance, and text fields need normal typing.
// F11 is no longer blocked either: fullscreen is now the operator's choice.
export function isBlockedShortcut(e: KeyboardEvent): boolean {
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  // Function keys: reload (F5), dev tools (F12).
  if (key === "F5" || key === "F12") return true;

  // Reload: Ctrl+R / Ctrl+Shift+R.
  if (e.ctrlKey && lower === "r") return true;

  // Close window / quit: Ctrl+W, Ctrl+Q.
  if (e.ctrlKey && (lower === "w" || lower === "q")) return true;

  // Print: Ctrl+P.
  if (e.ctrlKey && lower === "p") return true;

  // Find: Ctrl+F, Ctrl+G.
  if (e.ctrlKey && (lower === "f" || lower === "g")) return true;

  // Zoom: Ctrl+'+', Ctrl+'-', Ctrl+'0'.
  if (e.ctrlKey && (key === "+" || key === "-" || key === "=" || key === "0")) return true;

  // Dev tools: Ctrl+Shift+I / J / C.
  if (e.ctrlKey && e.shiftKey && (lower === "i" || lower === "j" || lower === "c")) return true;

  // Tab-cycling within the app chrome: Ctrl+Tab.
  if (e.ctrlKey && key === "Tab") return true;

  // History navigation: Alt+ArrowLeft / Alt+ArrowRight.
  if (e.altKey && (key === "ArrowLeft" || key === "ArrowRight")) return true;

  return false;
}
