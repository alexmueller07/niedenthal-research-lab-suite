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

/**
 * One conversation recording found on the Research Drive, under a dyad number.
 *
 * This replaced a Round Robin lookup keyed on the participant's email address
 * (2026-09-24). That lookup needed a session on the server, a generated
 * rotation, a claimed room, the participant on the schedule, and the address
 * they signed in with to match the one the schedule had — five things that
 * could each be wrong while the recording sat on the drive. A dyad number is
 * one thing, and the recording room and this station both already have it.
 */
export interface DyadVideo {
  path: string;
  fileName: string;
  bytes: number;
  /** Seconds since the epoch, off the file itself. Newest first. */
  modifiedAt: number;
  /** Stable per file, so re-picking one reuses the local copy. */
  recordingId: string;
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

/**
 * Every conversation filed under this dyad on the Research Drive, newest first.
 *
 * An empty list is an ordinary answer, not a failure — the recording room may
 * still be copying. The setup screen says so and keeps the file picker open,
 * exactly as it always did.
 */
export const findDyadVideos = (dyadId: string) =>
  invoke<DyadVideo[]>("find_dyad_videos", { dyadId });

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

/** "dyad-014_20260924-140312.mp4 · 842 MB · today 14:03" — a clip, for the RA. */
export function describeVideo(video: DyadVideo): string {
  const when = new Date(video.modifiedAt * 1000);
  const stamp = Number.isNaN(when.getTime())
    ? ""
    : ` · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
  const size = video.bytes > 0 ? ` · ${Math.round(video.bytes / 1048576)} MB` : "";
  return `${video.fileName}${size}${stamp}`;
}
