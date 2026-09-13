// Machine-level researcher settings.
//
// The paths and defaults the lab sets once per machine, from the round-robin
// dashboard. All of them are optional: with none set, the app runs entirely
// self-contained (bundled proof-of-concept clips, per-machine tracking file),
// which is what a fresh install does.
//
// settings.json always lives in this machine's app-data folder — one of the
// things it stores is where everything else lives, so it cannot itself be
// relocated. Rust reads the same file (see store_dir in
// src-tauri/src/station/commands.rs).

import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  /**
   * Absolute path to the clip library (the lab's `mp4_noname` folder), or null
   * to use the proof-of-concept clips bundled in public/videos.
   */
  stimulusDir: string | null;
  /**
   * Absolute path to a shared folder holding the round-robin, session-board and
   * progress files, or null to keep them in this machine's app-data folder.
   * Point every lab machine at one folder and the dashboard sees every session
   * live.
   */
  storeDir: string | null;
  /**
   * Where each session's ratings.csv / transitions.csv folder is created. Null
   * means "the pps-data folder on the Research Drive", which is what the setup
   * screen fills in — an RA has not had to answer this question since
   * 2026-08-22.
   */
  dataDir: string | null;
  /**
   * The RA who runs this computer, remembered between sessions so it is one
   * fewer field to retype. It is written into every data file, so it is
   * editable on the setup screen rather than buried here.
   */
  raName: string;
}

export const EMPTY_SETTINGS: AppSettings = {
  stimulusDir: null,
  storeDir: null,
  dataDir: null,
  raName: "",
};

const LOCALSTORAGE_KEY = "pps-settings";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = hasTauri()
      ? await invoke<string>("load_settings")
      : (localStorage.getItem(LOCALSTORAGE_KEY) ?? "");
    if (!raw) return EMPTY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      stimulusDir: parsed.stimulusDir ?? null,
      storeDir: parsed.storeDir ?? null,
      dataDir: parsed.dataDir ?? null,
      raName: parsed.raName ?? "",
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

/** Joins with whichever separator the folder already uses (Windows or POSIX). */
export function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[/\\]+$/, "")}${separator}${name}`;
}

/**
 * Where this session's folder should be created, given what the machine knows.
 *
 * Preference order: an explicit dataDir, then a `pps-data` folder beside the
 * recordings on the Research Drive, then nothing — which is the only case that
 * puts a folder picker in front of an RA.
 */
export function resolveDataDir(
  settings: AppSettings,
  researchDriveRoot: string | null
): string | null {
  if (settings.dataDir && settings.dataDir.trim() !== "") return settings.dataDir.trim();
  if (researchDriveRoot && researchDriveRoot.trim() !== "") {
    return joinPath(researchDriveRoot.trim(), "pps-data");
  }
  return null;
}
