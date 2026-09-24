// Filenames for recordings, and the dyad number they are filed under.
//
// One number ties the whole pipeline together. An RA in the conversation room
// types the dyad ID and nothing else; the finished file is filed under it on
// the Research Drive; a rating station that knows the same dyad ID finds the
// video without asking a server, an email, or a person.
//
// Codes only — the lab's rule about identifiers applies to filenames as much
// as to source code — and a dyad number cannot name anybody, which is most of
// why it is the only thing this screen asks for.

/** Characters that survive into a filename, on every filesystem we target. */
export function sanitizeCode(code: string): string {
  return code
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
}

/**
 * The dyad number as everything downstream spells it: digits only, padded to
 * three. 14, 014 and " 14 " are the same dyad, and a station looking for 014
 * has to find a take an RA entered as 14.
 *
 * The FIRST run of digits, not all of them. RAs typed `dyad-014-room2` into
 * the field this replaced, and an RA who does it again out of habit must land
 * on dyad 014 — stripping every non-digit instead would read that as 0142 and
 * file the conversation under a dyad that does not exist.
 *
 * Returns "" for anything with no digits in it, which callers read as "not
 * filed under a dyad".
 */
export function normalizeDyadId(raw: string): string {
  const match = /\d+/.exec(raw);
  if (!match) return "";
  const trimmed = match[0].replace(/^0+(?=\d)/, "");
  return trimmed.padStart(3, "0");
}

/** `dyad-014` — the folder on the Research Drive a take is filed into. */
export function dyadFolder(dyadId: string): string {
  const id = normalizeDyadId(dyadId);
  return id ? `dyad-${id}` : "unfiled";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local time, because that is what an operator reads off the session log. */
export function timestamp(when: Date): string {
  return (
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  );
}

/**
 * The filename stem. Always carries a timestamp so two takes of the same dyad
 * cannot collide and silently overwrite each other.
 */
export function fileStem(code: string, when: Date): string {
  const dyad = normalizeDyadId(code);
  if (dyad) return `dyad-${dyad}_${timestamp(when)}`;
  const clean = sanitizeCode(code);
  return clean ? `${clean}_${timestamp(when)}` : `session_${timestamp(when)}`;
}

/**
 * Is this path on a network drive rather than on this computer?
 *
 * A UNC path (`\\research.drive.wisc.edu\niedenthal`) is unambiguous. A mapped
 * letter is not — `Z:` looks exactly like `C:` — so the rule is a heuristic:
 * the lab's local disks are C: and D:, and every letter the Research Drive has
 * been mapped to (R:, Z:) is further down the alphabet.
 *
 * Used for a warning only. Recording onto a share works; it just risks dropped
 * frames, so the RA is told rather than stopped. (Room B had its working folder
 * on `Z:\UW_Fall2026` on 2026-09-11, which is what prompted this.)
 */
export function isNetworkPath(path: string): boolean {
  const p = path.trim();
  if (!p) return false;
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  const drive = /^([A-Za-z]):[\\/]/.exec(p);
  if (!drive) return false;
  return !"CD".includes(drive[1].toUpperCase());
}
