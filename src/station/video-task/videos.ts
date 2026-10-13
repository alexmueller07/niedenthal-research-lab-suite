// Stimulus catalog for the video affective-response task (the "TikTok task").
//
// Twenty-five clips from the Cowen & Keltner emotional-video set, in five
// groups of five (eight each until 1.5.0). Ben sent the groupings and the emotion words on 2026-09-20; before
// that everything here was a placeholder — eight demo clips and five sets that
// all pointed at the same eight, so the random-assignment machinery was real
// and the content was not.
//
// WHICH GROUP A PARTICIPANT GETS — Randy, 2026-09-20: "TikTok task should have
// videos uniquely assigned to Round." Round 1 is group 1, round 2 is group 2,
// and so on. Two consequences, both deliberate:
//
//   - a participant cannot see the same clip twice across their five rounds,
//     which the previous rule (hash the dyad ID, draw 1 of 5) allowed on every
//     round after the first.
//   - two people rate the same clips exactly when they are on the same round
//     number. That is the normal case — everybody runs R1 together, then R2 —
//     and it is what keeps a pair's ratings comparable. A pair who have fallen
//     out of step (somebody missed a day) will rate different clips, and the
//     round number is written to the data file so that is visible in analysis
//     rather than silent.
//
// THE EMOTION WORDS are the three the Cowen & Keltner norms rate highest for
// that clip, restricted to the twelve emotions this study asks about. Checked
// against the published per-clip ratings (CowenKeltnerEmotionalVideos.csv)
// rather than taken on trust: all forty rows are that file's own top three
// within those twelve, with twelve of them settled by a tie at the cutoff.
// The full 34-category norms are not reproduced here — the CSV is the source
// and this is the study's reading of it.
//
// ⚠️ THE GROUPINGS ARE PROVISIONAL. Ben, 2026-09-20: "These groups may change,
// as the outcome of the survey of the RAs was that valence significantly
// differed across at least one grouping" — the RA survey found group 1 rated
// more negative than groups 2 and 3 (p < .001 and p = .001), while intensity
// did not differ (p = .51). Since the group is now the round, a valence
// difference between groups is a valence difference between rounds, which is
// confounded with order, fatigue and everything else that changes over an
// afternoon. Rebalancing means editing VIDEO_SETS below and nothing else.

// FIVE PER GROUP — Randy, 2026-10-13: "Set up 5 videos per condition: 2 clearly
// positive, 2 clearly negative, 1 mixed; flag which ones are selected." Each
// group of eight was cut to five INSIDE the group, so the round rule and the
// no-repeats guarantee still hold. The pick is scripts/select-clips.py over
// the published norms and is PROVISIONAL until Ben reviews it — see
// docs/station/CLIP-SELECTION.md for the numbers and the three dropped from
// each group.

import { convertFileSrc } from "@tauri-apps/api/core";

/** Number of emotions probed per clip. Each rating page asks this many questions. */
export const EMOTIONS_PER_VIDEO = 3;

/** Clips per set. Each participant watches this many clips, rating each twice. */
export const VIDEOS_PER_SET = 5;

/**
 * The emotions this study asks about, and the vocabulary Ben's top-three were
 * drawn from. Exported so the data-integrity test can prove no clip in the
 * catalog asks about an emotion outside it.
 */
export const STUDY_EMOTIONS = [
  "amusement",
  "anger",
  "anxiety",
  "awe",
  "awkwardness",
  "disappointment",
  "disgust",
  "fear",
  "joy",
  "sadness",
  "surprise",
  "sympathy",
] as const;

export interface StimulusVideo {
  /** Filename stem in the stimulus library, e.g. "1615" → 1615.mp4. */
  id: string;
  /**
   * The three emotions probed on the rating page, highest-rated first. Order is
   * randomized at run time and the drawn order is written to the data file.
   */
  emotions: string[];
  /**
   * Why this clip is in its group of five: 2 positive, 2 negative, 1 mixed
   * (Randy, 2026-10-13). Written to the data file beside the clip id.
   */
  valenceRole: ValenceRole;
}

export type ValenceRole = "positive" | "negative" | "mixed";

/**
 * Every clip the study uses, grouped the way VIDEO_SETS groups them so the two
 * cannot drift apart — the sets below are built from these arrays.
 */
const GROUP_1: StimulusVideo[] = [
  { id: "0353", emotions: ["surprise", "awe", "anxiety"], valenceRole: "positive" },
  { id: "1010", emotions: ["amusement", "surprise", "joy"], valenceRole: "positive" },
  { id: "2162", emotions: ["fear", "anxiety", "awe"], valenceRole: "negative" },
  { id: "1871", emotions: ["disgust", "amusement", "surprise"], valenceRole: "negative" },
  { id: "0900", emotions: ["fear", "anxiety", "amusement"], valenceRole: "mixed" },
];

const GROUP_2: StimulusVideo[] = [
  { id: "0970", emotions: ["awe", "anxiety", "surprise"], valenceRole: "positive" },
  { id: "1741", emotions: ["amusement", "joy", "surprise"], valenceRole: "positive" },
  { id: "1422", emotions: ["fear", "anxiety", "awe"], valenceRole: "negative" },
  { id: "1672", emotions: ["amusement", "awkwardness", "disappointment"], valenceRole: "negative" },
  { id: "1473", emotions: ["sadness", "sympathy", "awe"], valenceRole: "mixed" },
];

const GROUP_3: StimulusVideo[] = [
  { id: "0341", emotions: ["surprise", "joy", "amusement"], valenceRole: "positive" },
  { id: "1432", emotions: ["joy", "surprise", "sympathy"], valenceRole: "positive" },
  { id: "1979", emotions: ["anxiety", "amusement", "fear"], valenceRole: "negative" },
  { id: "1744", emotions: ["amusement", "surprise", "disgust"], valenceRole: "negative" },
  { id: "1148", emotions: ["amusement", "disgust", "awkwardness"], valenceRole: "mixed" },
];

const GROUP_4: StimulusVideo[] = [
  { id: "1635", emotions: ["amusement", "surprise", "anxiety"], valenceRole: "positive" },
  { id: "0381", emotions: ["awe", "surprise", "anxiety"], valenceRole: "positive" },
  { id: "0595", emotions: ["anger", "surprise", "disgust"], valenceRole: "negative" },
  { id: "0443", emotions: ["fear", "anxiety", "surprise"], valenceRole: "negative" },
  { id: "1732", emotions: ["awe", "fear", "anxiety"], valenceRole: "mixed" },
];

const GROUP_5: StimulusVideo[] = [
  { id: "0014", emotions: ["sympathy", "joy", "sadness"], valenceRole: "positive" },
  { id: "0424", emotions: ["amusement", "awe", "surprise"], valenceRole: "positive" },
  { id: "0913", emotions: ["disgust", "sadness", "fear"], valenceRole: "negative" },
  { id: "0451", emotions: ["surprise", "fear", "amusement"], valenceRole: "negative" },
  { id: "0436", emotions: ["anxiety", "fear", "awe"], valenceRole: "mixed" },
];

const GROUPS = [GROUP_1, GROUP_2, GROUP_3, GROUP_4, GROUP_5];

export const VIDEO_CATALOG: StimulusVideo[] = GROUPS.flat();

export interface VideoSet {
  /** Stable label written to the data file, e.g. "GROUP_1". */
  id: string;
  videoIds: string[];
}

/** The five groups, in round order: index 0 is round 1. */
export const VIDEO_SETS: VideoSet[] = GROUPS.map((clips, index) => ({
  id: `GROUP_${index + 1}`,
  videoIds: clips.map((clip) => clip.id),
}));

/** How many rounds have a group of their own. */
export const ROUNDS_WITH_SETS = VIDEO_SETS.length;

export function findVideo(id: string): StimulusVideo {
  const video = VIDEO_CATALOG.find((v) => v.id === id);
  if (!video) throw new Error(`Unknown stimulus video id: ${id}`);
  return video;
}

export function videosInSet(set: VideoSet): StimulusVideo[] {
  return set.videoIds.map(findVideo);
}

/** How a set was chosen. Written to the data file for reproducibility. */
export const SET_ASSIGNMENT_METHOD = "round number (R1 = group 1 … R5 = group 5)";

/**
 * The clips for a given round.
 *
 * Randy, 2026-09-20: the round picks the group, so nobody sees a clip twice
 * across their five rounds. A round past the fifth wraps rather than failing —
 * a sixth conversation is not in the protocol, but a session that reaches one
 * must keep running, and wrapping is the behaviour an analyst can see in the
 * data (the round and the group are both written to the file) rather than a
 * crash an RA has to work around mid-session.
 */
export function assignSet(round: number): VideoSet {
  const n = Math.trunc(round);
  if (!Number.isFinite(n) || n < 1) return VIDEO_SETS[0];
  return VIDEO_SETS[(n - 1) % VIDEO_SETS.length];
}

// ---- Where the clip files come from ----

/**
 * Resolves a playable URL for a clip.
 *
 * Two sources, in order:
 *   1. `stimulusDir` — an explicit clip library set on the researcher
 *      dashboard. The escape hatch for a lab that wants to swap the clips
 *      without shipping a new build.
 *   2. the clips bundled in the installer (`public/videos`), which since
 *      2026-09-21 is the whole study set rather than eight demo clips. This is
 *      what the real study uses: no folder to mount, nothing to configure, and
 *      the clips cannot be missing on one machine and present on another.
 *
 * Tauri serves local files over the `asset:` protocol (enabled in
 * tauri.conf.json); in a plain browser only the bundled copy exists.
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
