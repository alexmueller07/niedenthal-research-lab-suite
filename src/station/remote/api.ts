// Typed wrappers over the Rust `remote` commands — the Round Robin web app
// and the Research Drive fetch.
//
// Everything here degrades: no Tauri (browser dev), no configuration, or an
// unreachable server all surface as ordinary rejections the callers treat as
// "fall back to the manual picker" or "skip the report". Nothing in this
// module is ever allowed to block a session.

import { invoke } from "@tauri-apps/api/core";

export interface RemotePublic {
  roundRobinUrl: string | null;
  researchDriveRoot: string | null;
  /**
   * False when the folder above is this computer's own rather than the lab's
   * share. A station in that state can still run a session, but it can only
   * find a conversation recorded on this same machine.
   */
  driveIsShared: boolean;
  /** Folders this machine has used before, newest first — the one-click chips. */
  recentDriveRoots: string[];
}

export interface RemoteUpdate {
  roundRobinUrl?: string;
  researchDriveRoot?: string;
}

export interface ClipPartner {
  id: string;
  fullName: string;
  email: string;
}

/** One conversation the participant appears in, as Round Robin reports it. */
export interface RemoteClip {
  recordingId: string;
  slotId: string;
  sessionDate: string | null;
  round: number;
  roomIndex: number;
  durationMs: number | null;
  mimeType: string | null;
  partner: ClipPartner | null;
  url: string;
  storageKey?: string | null;
  sha256?: string | null;
}

export interface ClipsResponse {
  participant: { id: string; email: string; fullName: string };
  clips: RemoteClip[];
}

export interface PreparedVideo {
  localPath: string;
  bytes: number;
  verified: boolean;
  cached: boolean;
}

export interface CopyProgress {
  recordingId: string;
  copiedBytes: number;
  totalBytes: number;
}

export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const remoteStatus = () => invoke<RemotePublic>("remote_status");

/**
 * Research Drive folders that exist on this computer right now, probed from
 * the places the lab mounts the share. Best-effort: an empty list only means
 * nothing was found at a known location, never that the drive is missing.
 */
export const detectDriveRoots = () => invoke<string[]>("detect_drive_roots");

export const remoteConfigure = (update: RemoteUpdate) =>
  invoke<RemotePublic>("remote_configure", { update });

/**
 * Closes the station window and goes back to the mode chooser, or straight
 * into another mode. Everything the session holds must already be flushed —
 * see flushRegistry — because this does not come back.
 */
export const leaveMode = (role: "record" | "station" | "control" | null = null) =>
  invoke<void>("leave_mode", { role });

/** Proves the server answers and the Research Drive is mounted, in RA words. */
export const remoteTest = () => invoke<string>("remote_test");

export const listConversationClips = (email: string) =>
  invoke<ClipsResponse>("list_conversation_clips", { email });

export const prepareConversationVideo = (
  recordingId: string,
  storageKey: string,
  sha256: string | null
) =>
  invoke<PreparedVideo>("prepare_conversation_video", {
    request: { recordingId, storageKey, sha256 },
  });

/**
 * Where a recording sits on this computer's Research Drive, without copying it.
 *
 * The setup screen needs a path before the ~1 GB copy has started, so it can
 * show the RA a frame and let them confirm the right conversation.
 */
export const resolveClipPath = (storageKey: string) =>
  invoke<string>("resolve_clip_path", { storageKey });

/**
 * One frame from a video file, as a blob URL the caller owns.
 *
 * The caller must revokeObjectURL it — the frame is a few tens of KB, but a
 * setup screen an RA fiddles with can produce a dozen of them.
 */
export async function videoThumbnailUrl(path: string, atSeconds = 2): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("video_thumbnail", { path, atSeconds });
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

/**
 * Copies a file the RA browsed to into the same local cache a fetched
 * recording lands in, so it plays off local disk rather than streaming over
 * SMB. `recordingId` must be stable per file — see fnv1aHex in utils/hash.ts.
 */
export const prepareLocalVideo = (recordingId: string, path: string) =>
  invoke<PreparedVideo>("prepare_local_video", { recordingId, path });

export const reportStudyProgress = (
  email: string,
  stage: string,
  percent: number | null,
  needsHelp: boolean
) =>
  invoke<void>("report_study_progress", {
    email,
    stage,
    percent,
    needsHelp,
  });

/**
 * Which recording a fresh session should rate: the newest one — latest
 * session date, then highest round within it. In the current dyadic protocol
 * a participant has exactly one, and this returns it; in a multi-round
 * round-robin session it returns the conversation that just ended, and the
 * setup screen offers the rest for the RA to choose from.
 */
export function newestClip(clips: RemoteClip[]): RemoteClip | null {
  if (clips.length === 0) return null;
  return [...clips].sort(
    (a, b) =>
      (b.sessionDate ?? "").localeCompare(a.sessionDate ?? "") ||
      b.round - a.round ||
      a.roomIndex - b.roomIndex
  )[0];
}

/** "Round 2 with Jordan P. — Aug 13" — how a clip is named for the RA. */
export function describeClip(clip: RemoteClip): string {
  const who = clip.partner ? ` with ${clip.partner.fullName}` : "";
  const when = clip.sessionDate ? ` — ${clip.sessionDate}` : "";
  return `Round ${clip.round}${who}${when}`;
}

/** Clips the desktop app can actually fetch off the Research Drive. */
export function fetchableClips(clips: RemoteClip[]): RemoteClip[] {
  return clips.filter((c) => Boolean(c.storageKey));
}
