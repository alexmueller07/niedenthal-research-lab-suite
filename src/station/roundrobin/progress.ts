// Live study-progress tracking for the round-robin ("panopticon") dashboard.
//
// The dashboard already tracks who has met whom across days. This adds the
// other half of what the researcher needs during a session: how far through the
// app each participant currently is, and whether anyone has pressed the help
// button.
//
// Storage: one small JSON file per participant under `progress/` in the
// round-robin store folder, named by a hash of the email rather than the email
// itself (the email lives inside the file; there is no reason to spread
// identifiers across filenames too — IRB 2020-1657).
//
// One file per participant, not one shared file, is deliberate: when the store
// folder is a shared drive, each lab machine only ever writes its own
// participant's file, so two sessions running at once cannot overwrite each
// other. The one exception is the researcher clearing a help flag, which writes
// to the participant's file; if that collides with a page transition the flag
// simply needs clearing again.

import { invoke } from "@tauri-apps/api/core";
import { fnv1aHex } from "../utils/hash";
import { normalizeEmail } from "./store";

/** The stages a participant moves through, in order. */
export const STUDY_STAGES = [
  { key: "checkin", label: "Checked in" },
  { key: "setup", label: "Researcher setup" },
  { key: "postconv", label: "Post-conversation questions" },
  { key: "dyad", label: "Conversation rating" },
  { key: "video", label: "Video affective-response task" },
  { key: "questionnaires", label: "Questionnaires" },
  { key: "done", label: "Finished" },
] as const;

export type StageKey = (typeof STUDY_STAGES)[number]["key"];

export interface RRProgress {
  email: string;
  stage: StageKey;
  /** Steps completed within the current stage. */
  done: number;
  /** Steps in the current stage; 0 when the stage has no step count. */
  total: number;
  /** Free-text detail for the dashboard, e.g. "Video 12 of 25". */
  detail?: string;
  updatedAt: string;
  /** Set when the participant presses the help button; cleared by the researcher. */
  helpRequestedAt?: string | null;
  helpResolvedAt?: string | null;
}

export type ProgressMap = { [email: string]: RRProgress };

const LOCALSTORAGE_KEY = "pps-progress";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Filename for a participant's progress file: `p-<hash>.json`. */
export function progressFileName(email: string): string {
  return `p-${fnv1aHex(normalizeEmail(email))}.json`;
}

export function stageIndex(stage: StageKey): number {
  const index = STUDY_STAGES.findIndex((s) => s.key === stage);
  return index === -1 ? 0 : index;
}

export function stageLabel(stage: StageKey): string {
  return STUDY_STAGES[stageIndex(stage)].label;
}

/**
 * Fraction of the whole session complete, 0-1. Each stage is one equal slice;
 * within a stage the step count fills that slice. Rough by design — it answers
 * "roughly how far along is this person" for an RA glancing at a screen, not
 * anything that goes into analysis.
 */
export function overallFraction(p: RRProgress): number {
  const slices = STUDY_STAGES.length - 1; // "done" is the end, not a slice
  const within = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return Math.min(1, (stageIndex(p.stage) + within) / slices);
}

export function isHelpOpen(p: RRProgress): boolean {
  if (!p.helpRequestedAt) return false;
  if (!p.helpResolvedAt) return true;
  return new Date(p.helpResolvedAt) < new Date(p.helpRequestedAt);
}

export async function loadProgress(): Promise<ProgressMap> {
  try {
    if (hasTauri()) {
      const files = await invoke<string[]>("load_progress");
      const map: ProgressMap = {};
      for (const raw of files) {
        try {
          const entry = JSON.parse(raw) as RRProgress;
          if (entry?.email) map[normalizeEmail(entry.email)] = entry;
        } catch {
          // A single unreadable file must not hide everyone else's progress.
          console.error("Skipping unreadable progress file");
        }
      }
      return map;
    }
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch (err) {
    console.error("Progress load failed:", err);
    return {};
  }
}

export async function saveProgress(entry: RRProgress): Promise<void> {
  const normalized: RRProgress = { ...entry, email: normalizeEmail(entry.email) };
  if (hasTauri()) {
    await invoke("save_progress", {
      fileName: progressFileName(normalized.email),
      contents: JSON.stringify(normalized, null, 2),
    });
    return;
  }
  const current = await loadProgress();
  current[normalized.email] = normalized;
  localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(current));
}

/** Merges a partial update into a participant's record. */
export function mergeProgress(
  existing: RRProgress | undefined,
  email: string,
  patch: Partial<RRProgress>
): RRProgress {
  return {
    email,
    stage: "checkin",
    done: 0,
    total: 0,
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}
