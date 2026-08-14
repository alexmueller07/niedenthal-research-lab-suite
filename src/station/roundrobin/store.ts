// Round-robin tracking store.
//
// Tracks who has met whom across days: every participant signs in with just
// their email, is randomly placed into a group of 5, and must eventually meet
// every other member of their group. The researcher (sign in as admin@admin)
// sees all groups, marks pairs as met, and can read off who is still left.
//
// Persistence: one JSON file in the Tauri app-data directory (see
// load_roundrobin/save_roundrobin in src-tauri). It contains participant
// emails — an identifier under IRB 2020-1657 — so the file stays on the lab
// machine / UW Research Drive and is never committed or copied elsewhere.
// In plain-browser dev (no Tauri) it falls back to localStorage.

import { invoke } from "@tauri-apps/api/core";

export const GROUP_SIZE = 5;
export const ADMIN_EMAIL = "admin@admin";

export interface RRParticipant {
  email: string;
  group: number;
  joinedAt: string;
}

export interface RRData {
  version: 1;
  groupSize: number;
  participants: RRParticipant[];
  /** pairKey (two emails sorted, joined with "|") → ISO date the pair met. */
  meetings: { [pairKey: string]: string };
}

export function emptyData(): RRData {
  return { version: 1, groupSize: GROUP_SIZE, participants: [], meetings: {} };
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === ADMIN_EMAIL;
}

export function pairKey(a: string, b: string): string {
  return [normalizeEmail(a), normalizeEmail(b)].sort().join("|");
}

const LOCALSTORAGE_KEY = "pps-roundrobin";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadData(): Promise<RRData> {
  try {
    let raw: string;
    if (hasTauri()) {
      raw = await invoke<string>("load_roundrobin");
    } else {
      raw = localStorage.getItem(LOCALSTORAGE_KEY) ?? "";
    }
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as RRData;
    if (parsed.version !== 1 || !Array.isArray(parsed.participants)) return emptyData();
    return parsed;
  } catch (err) {
    console.error("Round-robin store load failed:", err);
    return emptyData();
  }
}

/** Persists the store. Returns the file path (Tauri) or null (dev fallback). */
export async function saveData(data: RRData): Promise<string | null> {
  const raw = JSON.stringify(data, null, 2);
  if (hasTauri()) {
    return invoke<string>("save_roundrobin", { contents: raw });
  }
  localStorage.setItem(LOCALSTORAGE_KEY, raw);
  return null;
}

/**
 * Merges two snapshots of the store, for the moment just before a save. Both
 * lab check-in machines write the same file, and the copy loaded at app start
 * goes stale the moment the other machine saves — writing it back would erase
 * that machine's sign-ins (last-write-wins). Participants are united by email
 * with the on-disk entry winning, so a group assignment made on the other
 * machine is never re-rolled; meetings are united by pair key, disk winning
 * on conflict for the same reason.
 */
export function mergeData(disk: RRData, memory: RRData): RRData {
  const byEmail = new Map<string, RRParticipant>();
  for (const p of disk.participants) byEmail.set(p.email, p);
  for (const p of memory.participants) {
    if (!byEmail.has(p.email)) byEmail.set(p.email, p);
  }
  return {
    version: 1,
    groupSize: disk.groupSize,
    participants: [...byEmail.values()],
    meetings: { ...memory.meetings, ...disk.meetings },
  };
}

export function findParticipant(data: RRData, email: string): RRParticipant | undefined {
  const normalized = normalizeEmail(email);
  return data.participants.find((p) => p.email === normalized);
}

/**
 * Signs a participant in. A returning email keeps its group; a new email is
 * placed into a randomly chosen group that still has an open seat, or a brand
 * new group when every group is full. (Random placement — not fill-in-order —
 * so late joiners are not systematically grouped together.)
 */
export function signIn(
  data: RRData,
  email: string
): { data: RRData; participant: RRParticipant; isNew: boolean } {
  const existing = findParticipant(data, email);
  if (existing) return { data, participant: existing, isNew: false };

  const counts = new Map<number, number>();
  for (const p of data.participants) {
    counts.set(p.group, (counts.get(p.group) ?? 0) + 1);
  }
  const open = [...counts.entries()]
    .filter(([, n]) => n < data.groupSize)
    .map(([g]) => g);

  let group: number;
  if (open.length > 0) {
    group = open[Math.floor(Math.random() * open.length)];
  } else {
    group = counts.size === 0 ? 1 : Math.max(...counts.keys()) + 1;
  }

  const participant: RRParticipant = {
    email: normalizeEmail(email),
    group,
    joinedAt: new Date().toISOString(),
  };
  const next: RRData = { ...data, participants: [...data.participants, participant] };
  return { data: next, participant, isNew: true };
}

export function groupNumbers(data: RRData): number[] {
  return [...new Set(data.participants.map((p) => p.group))].sort((a, b) => a - b);
}

export function groupMembers(data: RRData, group: number): RRParticipant[] {
  return data.participants
    .filter((p) => p.group === group)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export interface RRPair {
  a: string;
  b: string;
  /** ISO date the pair met, or null if still pending. */
  metAt: string | null;
}

/** Every within-group pair (each member must meet every other member). */
export function groupPairs(data: RRData, group: number): RRPair[] {
  const members = groupMembers(data, group);
  const pairs: RRPair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const key = pairKey(members[i].email, members[j].email);
      pairs.push({
        a: members[i].email,
        b: members[j].email,
        metAt: data.meetings[key] ?? null,
      });
    }
  }
  return pairs;
}

/** Marks a pair as met now, or clears it when already met (undo). */
export function toggleMeeting(data: RRData, a: string, b: string): RRData {
  const key = pairKey(a, b);
  const meetings = { ...data.meetings };
  if (meetings[key]) {
    delete meetings[key];
  } else {
    meetings[key] = new Date().toISOString();
  }
  return { ...data, meetings };
}

/** How many group partners this participant has met vs. still needs to meet. */
export function participantProgress(
  data: RRData,
  email: string
): { met: number; total: number; remaining: string[] } {
  const me = findParticipant(data, email);
  if (!me) return { met: 0, total: 0, remaining: [] };
  const others = groupMembers(data, me.group).filter((p) => p.email !== me.email);
  const remaining = others
    .filter((p) => !data.meetings[pairKey(me.email, p.email)])
    .map((p) => p.email);
  return { met: others.length - remaining.length, total: others.length, remaining };
}
