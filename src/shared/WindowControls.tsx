import { useEffect, useState } from "react";

// Minimise and close, for windows that no longer have a title bar.
//
// The suite's windows lost their chrome on 2026-08-29 at the lab's request, and
// with it the only way to minimise or close them with a mouse. This puts both
// back, in the corner, small enough to ignore.
//
// Close calls the window's own close(), NOT an exit — so every guard in
// modes.rs::handle_window_event still runs: the recorder refuses mid-take and
// says why, and the station routes to the researcher save-and-quit modal rather
// than dropping the ~15 s of slider samples it is holding. This component
// deliberately knows none of that.
//
// The station does not render it. It is a kiosk a participant is sitting at,
// and a close button beside their task is the one thing on screen that could
// end a session by accident; Ctrl+Shift+Q remains the way out of it.

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface WindowControlsProps {
  /** Extra classes for placement. Defaults to the top-right of the window. */
  className?: string;
}

export default function WindowControls({
  className = "fixed right-3 top-3 z-50",
}: WindowControlsProps) {
  // Rendering nothing in the browser preview: close() there does nothing and a
  // dead button is worse than no button.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => setEnabled(hasTauri()), []);
  if (!enabled) return null;

  const act = async (what: "minimize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (what === "minimize") await win.minimize();
      else await win.close();
    } catch (err) {
      console.error(`Window ${what} failed:`, err);
    }
  };

  const buttonClass =
    "flex h-7 w-7 items-center justify-center rounded-md border border-(--color-panel-edge) " +
    "text-(--color-ink-dim) transition-colors hover:border-(--color-ink-dim) hover:text-(--color-ink)";

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        title="Minimise"
        aria-label="Minimise"
        onClick={() => void act("minimize")}
        className={buttonClass}
      >
        {/* A bare glyph rather than an icon font: one character, no dependency. */}
        <span aria-hidden className="translate-y-[-2px] text-sm leading-none">
          –
        </span>
      </button>
      <button
        type="button"
        title="Close"
        aria-label="Close"
        onClick={() => void act("close")}
        className={`${buttonClass} hover:border-(--color-bad) hover:text-(--color-bad)`}
      >
        <span aria-hidden className="text-sm leading-none">
          ×
        </span>
      </button>
    </div>
  );
}
