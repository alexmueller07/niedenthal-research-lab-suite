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
  secretConfigured: boolean;
}

export interface RemoteUpdate {
  roundRobinUrl?: string;
  /** Empty string clears it; omitting the field leaves it untouched. */
  roundRobinSecret?: string;
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

export const remoteConfigure = (update: RemoteUpdate) =>
  invoke<RemotePublic>("remote_configure", { update });

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
