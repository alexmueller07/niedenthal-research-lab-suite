// Stimulus catalog for the video affective-response task.
//
// The task replaces the situational emotion-rating ("scenarios") task, which in
// turn replaced the original emotion-transition task. Instead of reading a
// written situation, the participant watches a short film clip and rates how
// strongly it evokes each of three emotions — for themselves, for their
// partner, and for an average UW-Madison student.
//
// Clips live in the lab's `mp4_noname` library and are referenced by their
// four-digit stem (`1615` → `1615.mp4`). The eight proof-of-concept clips are
// committed under public/videos so every build runs with no setup; the full
// library is not, and the real study points at it instead. See resolveVideoSrc.
//
// PROOF OF CONCEPT — still pending Randy:
//   - The eight clips below are the ones Alex selected for the demo. Randy has
//     not finalized the real sets yet.
//   - All five sets currently point at those same eight clips so the
//     random-set-assignment machinery is real and demonstrable. Replacing a set
//     is a one-line edit per set once the real groupings exist.
//
// Settled (Alex, 2026-07-23):
//   - Clip 0494 is annotated with five emotions (disgust, fear, sadness,
//     disappointment, anger). The task probes exactly three per clip, and the
//     three are disgust, fear and sadness. All five stay in `annotated` for the
//     record.

import { convertFileSrc } from "@tauri-apps/api/core";
import { fnv1a } from "../utils/hash";

/** Number of emotions probed per clip. The rating page renders 2 × this many questions. */
export const EMOTIONS_PER_VIDEO = 3;

/** Clips per set. Each participant rates this many clips per target. */
export const VIDEOS_PER_SET = 8;

export interface StimulusVideo {
  /** Filename stem in the stimulus library, e.g. "1615" → 1615.mp4. */
  id: string;
  /** The three emotions probed on the rating page. Order is randomized at run time. */
  emotions: string[];
  /**
   * Full emotion annotation from the library, when it lists more than the three
   * probed. Recorded here so the choice stays auditable; not shown to participants.
   */
  annotated?: string[];
}

export const VIDEO_CATALOG: StimulusVideo[] = [
  { id: "1615", emotions: ["awe", "fear", "anxiety"] },
  {
    id: "0494",
    // Three of the five annotated emotions, chosen by Alex on 2026-07-23.
    emotions: ["disgust", "fear", "sadness"],
    annotated: ["disgust", "fear", "sadness", "disappointment", "anger"],
  },
  { id: "1097", emotions: ["joy", "amusement", "awe"] },
  { id: "0027", emotions: ["amusement", "surprise", "sympathy"] },
  { id: "0366", emotions: ["joy", "amusement", "awe"] },
  { id: "0962", emotions: ["surprise", "fear", "anxiety"] },
  { id: "0014", emotions: ["joy", "sadness", "sympathy"] },
  { id: "1328", emotions: ["joy", "amusement", "awe"] },
];

export interface VideoSet {
  /** Stable label written to the data file, e.g. "SET_A". */
  id: string;
  videoIds: string[];
}

const DEMO_EIGHT = VIDEO_CATALOG.map((v) => v.id);

/**
 * The five premade sets. A dyad is assigned exactly one of them.
 *
 * PLACEHOLDER: every set is the same eight clips until Randy finalizes the
 * groupings. The full study needs at least 40 unique clips (5 × 8).
 */
export const VIDEO_SETS: VideoSet[] = [
  { id: "SET_A", videoIds: DEMO_EIGHT },
  { id: "SET_B", videoIds: DEMO_EIGHT },
  { id: "SET_C", videoIds: DEMO_EIGHT },
  { id: "SET_D", videoIds: DEMO_EIGHT },
  { id: "SET_E", videoIds: DEMO_EIGHT },
];

export function findVideo(id: string): StimulusVideo {
  const video = VIDEO_CATALOG.find((v) => v.id === id);
  if (!video) throw new Error(`Unknown stimulus video id: ${id}`);
  return video;
}

export function videosInSet(set: VideoSet): StimulusVideo[] {
  return set.videoIds.map(findVideo);
}

/** How a dyad's set was chosen. Written to the data file for reproducibility. */
export const SET_ASSIGNMENT_METHOD = "fnv1a(dyadId) mod 5";

/**
 * Assigns one of the five sets to a dyad.
 *
 * Yoking requirement: both members of a dyad must rate the same clips. Rather
 * than pass the assignment between the two lab machines, both derive it from
 * the Dyad ID they were each given on the participant form — same ID, same set,
 * no communication needed. Across dyads the hash spreads IDs evenly enough to
 * act as the 1-in-5 random draw the protocol calls for.
 *
 * An empty Dyad ID (dev / testing only) falls back to a real random draw.
 */
export function assignSet(dyadId: string): VideoSet {
  const key = dyadId.trim().toLowerCase();
  const index = key
    ? fnv1a(key) % VIDEO_SETS.length
    : Math.floor(Math.random() * VIDEO_SETS.length);
  return VIDEO_SETS[index];
}

// ---- Where the clip files come from ----

/**
 * Resolves a playable URL for a clip.
 *
 * Two sources, in order:
 *   1. `stimulusDir` — the lab's clip library (the `mp4_noname` folder on the
 *      Research Drive or a local copy), picked once by the researcher on the
 *      dashboard. This is the path the real study uses: the clips stay out of
 *      the installer and out of git.
 *   2. `public/videos/` — a bundled fallback holding just the eight
 *      proof-of-concept clips, committed so `npm run dev`, a fresh clone and the
 *      CI installers all work with no setup. `npm run stimuli` repopulates it
 *      from the full library when the set changes.
 *
 * Tauri serves local files over the `asset:` protocol (enabled in
 * tauri.conf.json); in a plain browser only the bundled fallback exists.
 */
export function resolveVideoSrc(id: string, stimulusDir: string | null): string {
  if (stimulusDir && hasTauri()) {
    return convertFileSrc(joinPath(stimulusDir, `${id}.mp4`));
  }
  return `${import.meta.env.BASE_URL}videos/${id}.mp4`;
}

/** Joins with whichever separator the folder already uses (Windows or POSIX). */
export function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[/\\]+$/, "")}${separator}${name}`;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
