// The round ledger.
//
// A session used to be one conversation: an RA set the station up, the
// participant did the whole study, and the computer was done. Randy changed
// that on 2026-09-19. A participant now stays at the same computer all
// afternoon and goes round after round with different partners — Green talks to
// Orange, then to Purple, then to Red — and comes back to this app between each
// one. Some of them come back on a different day.
//
// Two questions follow from that, and neither can be answered from the CSVs,
// because the CSVs are what the answer names:
//
//   1. "Which round is this person on?" The app has to know before it opens a
//      file, and it has to still know after the app has been closed and the
//      machine rebooted.
//   2. "Which data file belongs to which pairing?" One folder now holds
//      ratings_R1.csv, ratings_R2.csv and so on, and what tells them apart is
//      not in the filename — it is who the partner was.
//
// So one record per completed round goes here, in rounds.json, beside
// roundrobin.json and session-board.json in the shared tracking folder (see
// store_dir in src-tauri/src/station/commands.rs). Every station writes it, so
// a participant who moves machines mid-day still gets the right round number.
//
// IRB 2020-1657: study IDs, colours, filenames and timestamps. No names, no
// emails. The round-robin store is where emails live and it stays separate.

import { invoke } from "@tauri-apps/api/core";

export interface RoundRecord {
  /** Study ID of the participant who sat at this station. */
  participantId: string;
  /** Their nametag colour for this round — "" if the RA typed IDs by hand. */
  participantColor: string;
  /** Study ID of who they talked to. */
  partnerId: string;
  partnerColor: string;
  /** Which seat this station was. "Left" | "Right". */
  seat: string;
  /** Dyad ID for this pairing. A new pairing is a new dyad. */
  dyadId: string;
  /** 1-based. R1 is the participant's first conversation, ever. */
  round: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Local clock, HH:MM. */
  time: string;
  /** Absolute path of the folder holding this round's files. */
  folder: string;
  /** Filenames inside that folder, e.g. "ratings_R2.csv". */
  ratingsFile: string;
  transitionsFile: string;
  /** When the round finished, for ordering when two rounds share a minute. */
  completedAt: string;
  raName: string;
  groupId: string;
}

export interface RoundsLedger {
  version: 1;
  rounds: RoundRecord[];
}

export function emptyLedger(): RoundsLedger {
  return { version: 1, rounds: [] };
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const LOCALSTORAGE_KEY = "pps-rounds";

export async function loadRounds(): Promise<RoundsLedger> {
  try {
    const raw = hasTauri()
      ? await invoke<string>("load_rounds")
      : (localStorage.getItem(LOCALSTORAGE_KEY) ?? "");
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as RoundsLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.rounds)) return emptyLedger();
    return parsed;
  } catch (err) {
    console.error("Round ledger load failed:", err);
    return emptyLedger();
  }
}

export async function saveRounds(ledger: RoundsLedger): Promise<void> {
  const raw = JSON.stringify(ledger, null, 2);
  if (hasTauri()) {
    await invoke("save_rounds", { contents: raw });
    return;
  }
  localStorage.setItem(LOCALSTORAGE_KEY, raw);
}

/**
 * Unites two snapshots of the ledger.
 *
 * Same problem, same rule as the round-robin store and the session board: every
 * station writes this file, so the copy loaded when the app started is stale
 * the moment another station finishes a round. A record is identified by
 * (participant, round) — a participant cannot do their third round twice — and
 * the on-disk copy wins, so a round another machine recorded is never erased by
 * a save from this one.
 */
export function mergeLedgers(disk: RoundsLedger, memory: RoundsLedger): RoundsLedger {
  const byKey = new Map<string, RoundRecord>();
  const key = (r: RoundRecord) => `${r.participantId}#${r.round}`;
  for (const record of memory.rounds) byKey.set(key(record), record);
  for (const record of disk.rounds) byKey.set(key(record), record);
  return { version: 1, rounds: [...byKey.values()] };
}

/** Every round this participant has completed, oldest first. */
export function roundsFor(ledger: RoundsLedger, participantId: string): RoundRecord[] {
  const id = participantId.trim();
  if (!id) return [];
  return ledger.rounds
    .filter((r) => r.participantId === id)
    .sort((a, b) => a.round - b.round);
}

/**
 * The round number the participant is about to do.
 *
 * Max + 1 rather than count + 1: if a round was recorded on another machine and
 * this one has a stale copy, counting would hand out a number that is already
 * taken and two pairings would claim the same file. Taking the maximum can only
 * ever skip a number, which costs nothing, instead of colliding, which costs a
 * round of data.
 */
export function nextRoundNumber(ledger: RoundsLedger, participantId: string): number {
  const mine = roundsFor(ledger, participantId);
  if (mine.length === 0) return 1;
  return Math.max(...mine.map((r) => r.round)) + 1;
}

/** `ratings_R3.csv` — the ratings file for a given round. */
export function ratingsFileName(round: number): string {
  return `ratings_R${round}.csv`;
}

/** `transitions_R3.csv` — the questionnaire file for a given round. */
export function transitionsFileName(round: number): string {
  return `transitions_R${round}.csv`;
}

/**
 * Adds a completed round, re-reading the file first.
 *
 * Load-merge-save rather than save: see mergeLedgers. The window in which two
 * stations can still lose each other's round is the few milliseconds between
 * this load and this save, rather than the length of a session.
 */
export async function recordRound(record: RoundRecord): Promise<RoundsLedger> {
  const onDisk = await loadRounds();
  const next = mergeLedgers(onDisk, { version: 1, rounds: [record] });
  await saveRounds(next);
  return next;
}
