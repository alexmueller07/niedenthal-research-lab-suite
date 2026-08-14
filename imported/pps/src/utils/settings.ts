// Machine-level researcher settings.
//
// Two folder paths the lab sets once per machine, from the round-robin
// dashboard. Both are optional: with neither set, the app runs entirely
// self-contained (bundled proof-of-concept clips, per-machine tracking file),
// which is what a fresh install does.
//
// settings.json always lives in this machine's app-data folder — one of the
// things it stores is where everything else lives, so it cannot itself be
// relocated. Rust reads the same file (see store_dir in src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";

/**
 * How the video task collects the three perspectives.
 *
 * "separate" — the clips are gone through three times, once per perspective.
 *              One perspective is on screen at a time.
 * "combined" — the clips are gone through once, and every emotion is rated for
 *              all three perspectives on the same page.
 *
 * Randy asked (2026-07-30) whether combining would save time; Ben's counter is
 * that seeing all three at once invites participants to norm their own answer
 * against what they just said the average student would feel. Both are built;
 * which one runs is a setting rather than a code change, so it can be switched
 * in the meeting and switched back.
 */
export type VideoRatingMode = "separate" | "combined";

export interface AppSettings {
  /**
   * Absolute path to the clip library (the lab's `mp4_noname` folder), or null
   * to use the proof-of-concept clips bundled in public/videos.
   */
  stimulusDir: string | null;
  /**
   * Absolute path to a shared folder holding the round-robin and progress
   * files, or null to keep them in this machine's app-data folder. Point every
   * lab machine at one folder and the dashboard sees every session live.
   */
  storeDir: string | null;
  /** See VideoRatingMode. Defaults to "separate" — the current protocol. */
  videoRatingMode: VideoRatingMode;
  /**
   * Whether a clip must be watched all the way through again in the second and
   * third perspective blocks ("separate" mode only).
   *
   * Off by default since 2026-07-30: Ben, Sarah, Eddy and Prior all said the
   * forced rewatch was the tedious part. The clip is still replayable on demand
   * and the first viewing is still compulsory; what changed is that a
   * participant who remembers the clip can go straight to rating it. Whether a
   * rating followed a fresh viewing is recorded per trial (`watch_plays`), so
   * the difference stays visible in analysis.
   */
  requireRewatch: boolean;
}

export const EMPTY_SETTINGS: AppSettings = {
  stimulusDir: null,
  storeDir: null,
  videoRatingMode: "separate",
  requireRewatch: false,
};

const LOCALSTORAGE_KEY = "pps-settings";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = hasTauri()
      ? await invoke<string>("load_settings")
      : localStorage.getItem(LOCALSTORAGE_KEY) ?? "";
    if (!raw) return EMPTY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      stimulusDir: parsed.stimulusDir ?? null,
      storeDir: parsed.storeDir ?? null,
      videoRatingMode:
        parsed.videoRatingMode === "combined" ? "combined" : EMPTY_SETTINGS.videoRatingMode,
      requireRewatch: parsed.requireRewatch ?? EMPTY_SETTINGS.requireRewatch,
    };
  } catch (err) {
    console.error("Settings load failed:", err);
    return EMPTY_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const raw = JSON.stringify(settings, null, 2);
  if (hasTauri()) {
    await invoke("save_settings", { contents: raw });
    return;
  }
  localStorage.setItem(LOCALSTORAGE_KEY, raw);
}
