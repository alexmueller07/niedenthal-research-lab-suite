// Today's dyads, as the head RA sets them up before anyone walks in.
//
// The problem this solves came out of the lab's walkthrough (2026-08-22). Each
// rating station asked its own RA to type the dyad ID, both study IDs and the
// seat, from memory, mid-session, with the participant already sitting there.
// Two RAs typing the same numbers independently is two chances to disagree,
// and a mismatched dyad ID does not announce itself: the pair is silently
// unyoked, they get different video sets, and the empathic-accuracy scoring
// ends up comparing traces that were never meant to be compared.
//
// So the numbers are entered once, on the dashboard, by whoever is already
// handing out the nametags — and both stations read them back off the colour
// the participant is wearing. An RA at a station picks a colour and a seat;
// nothing else is typed.
//
// Storage: session-board.json, beside roundrobin.json in the shared tracking
// folder. It holds study IDs but no names or emails.

import { invoke } from "@tauri-apps/api/core";

/**
 * The nametag colours the lab hands out. Fixed rather than free text: the
 * whole point is that the RA at the station and the RA at the door mean the
 * same thing by "green", and a typed colour name cannot be matched reliably
 * (Green / green / Grn).
 */
export const NAMETAG_COLORS = [
  { key: "red", label: "Red", hex: "#d64545" },
  { key: "blue", label: "Blue", hex: "#3b76d6" },
  { key: "green", label: "Green", hex: "#3faa5a" },
  { key: "yellow", label: "Yellow", hex: "#d8b125" },
  { key: "purple", label: "Purple", hex: "#8c56c4" },
  { key: "orange", label: "Orange", hex: "#e0812b" },
  { key: "pink", label: "Pink", hex: "#d95d9c" },
  { key: "teal", label: "Teal", hex: "#2ba8a0" },
] as const;

export type ColorKey = (typeof NAMETAG_COLORS)[number]["key"];

export function colorLabel(key: string): string {
  return NAMETAG_COLORS.find((c) => c.key === key)?.label ?? key;
}

export function colorHex(key: string): string {
  return NAMETAG_COLORS.find((c) => c.key === key)?.hex ?? "#666";
}

export interface Seat {
  /** Nametag colour worn by whoever sits here. */
  color: ColorKey | "";
  /** Study ID written to the data files for this seat. */
  participantId: string;
}

export interface DyadEntry {
  dyadId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Local time the session starts, HH:MM. Free text; it is a label. */
  time: string;
  left: Seat;
  right: Seat;
  createdAt: string;
}

export interface SessionBoard {
  version: 1;
  dyads: DyadEntry[];
}

export function emptyBoard(): SessionBoard {
  return { version: 1, dyads: [] };
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const LOCALSTORAGE_KEY = "pps-session-board";

export async function loadBoard(): Promise<SessionBoard> {
  try {
    const raw = hasTauri()
      ? await invoke<string>("load_session_board")
      : (localStorage.getItem(LOCALSTORAGE_KEY) ?? "");
    if (!raw) return emptyBoard();
    const parsed = JSON.parse(raw) as SessionBoard;
    if (parsed.version !== 1 || !Array.isArray(parsed.dyads)) return emptyBoard();
    return parsed;
  } catch (err) {
    console.error("Session board load failed:", err);
    return emptyBoard();
  }
}

export async function saveBoard(board: SessionBoard): Promise<void> {
  const raw = JSON.stringify(board, null, 2);
  if (hasTauri()) {
    await invoke("save_session_board", { contents: raw });
    return;
  }
  localStorage.setItem(LOCALSTORAGE_KEY, raw);
}

/**
 * Both stations write the same file, so the copy held in memory goes stale the
 * moment the other machine saves. Same rule as the round-robin store: unite by
 * dyad ID, disk wins, so an entry added on the other computer is never erased
 * by a save from this one.
 */
export function mergeBoards(disk: SessionBoard, memory: SessionBoard): SessionBoard {
  const byId = new Map<string, DyadEntry>();
  for (const d of memory.dyads) byId.set(d.dyadId, d);
  for (const d of disk.dyads) byId.set(d.dyadId, d);
  return { version: 1, dyads: [...byId.values()] };
}

/** Today, as the board writes dates. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local clock as HH:MM, for the session-time label. */
export function nowHHMM(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function dyadsOn(board: SessionBoard, date: string): DyadEntry[] {
  return board.dyads
    .filter((d) => d.date === date)
    .sort((a, b) => a.time.localeCompare(b.time) || a.dyadId.localeCompare(b.dyadId));
}

/**
 * The study IDs that go with a dyad number.
 *
 * The protocol ties the seat to the parity of the ID: the left seat is the odd
 * one, and that is what decides which perspective a participant starts with and
 * how the pair is yoked. Deriving both IDs from the dyad number keeps that true
 * by construction instead of by everyone remembering — which is the kind of
 * rule that survives a training session and not a Thursday afternoon.
 *
 * Non-numeric dyad IDs (a pilot, a make-good) get nothing suggested; the RA
 * types them, and the dashboard says which one has to be odd.
 */
export function suggestSeatIds(dyadId: string): { left: string; right: string } | null {
  const n = Number(dyadId.trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return { left: String(2 * n - 1), right: String(2 * n) };
}

/** True when the left seat's ID is odd, as the protocol requires. */
export function seatParityHolds(entry: DyadEntry): boolean {
  const left = Number(entry.left.participantId);
  if (!Number.isInteger(left)) return true; // nothing to check
  return left % 2 === 1;
}

/** The next unused dyad number on the board, as a string. */
export function nextDyadId(board: SessionBoard): string {
  const numbers = board.dyads
    .map((d) => Number(d.dyadId))
    .filter((n) => Number.isInteger(n) && n > 0);
  return String(numbers.length === 0 ? 1 : Math.max(...numbers) + 1);
}

/** Colours already spoken for on a given day, so the board never reuses one. */
export function colorsTakenOn(board: SessionBoard, date: string): Set<string> {
  const taken = new Set<string>();
  for (const d of dyadsOn(board, date)) {
    if (d.left.color) taken.add(d.left.color);
    if (d.right.color) taken.add(d.right.color);
  }
  return taken;
}

/** Finds the dyad and seat a nametag colour belongs to, on a given day. */
export function findByColor(
  board: SessionBoard,
  date: string,
  color: string
): { entry: DyadEntry; seat: "left" | "right" } | null {
  for (const entry of dyadsOn(board, date)) {
    if (entry.left.color === color) return { entry, seat: "left" };
    if (entry.right.color === color) return { entry, seat: "right" };
  }
  return null;
}
