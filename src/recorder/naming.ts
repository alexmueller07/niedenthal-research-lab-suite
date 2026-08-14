// Filenames for recordings.
//
// The lab's hard rule (CLAUDE.md): no participant identifiers in filenames.
// Codes only. This module enforces the mechanical half of that — stripping
// anything that would break a path — and flags the cases a machine can
// recognise, which is a genuine help but not a substitute for the operator
// knowing the rule.

/** Characters that survive into a filename, on every filesystem we target. */
export function sanitizeCode(code: string): string {
  return code
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
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
 * The filename stem. Always carries a timestamp so two takes with the same
 * session code cannot collide and silently overwrite each other.
 */
export function fileStem(code: string, when: Date): string {
  const clean = sanitizeCode(code);
  return clean ? `${clean}_${timestamp(when)}` : `session_${timestamp(when)}`;
}

/**
 * Warns when a session code looks like it names a person.
 *
 * Catches the two mistakes a machine can actually see — an email address, and
 * something shaped like a first and last name. It cannot catch everything, so
 * it is worded as a question rather than a verdict.
 */
export function identifierWarning(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    return "That looks like an email address. Session codes must not contain participant identifiers.";
  }
  if (/^[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}$/.test(trimmed)) {
    return "That looks like a person's name. Use a dyad or session code instead.";
  }
  if (/\b[a-z]{2,8}\d{3,8}\b/i.test(trimmed) && /wisc|netid/i.test(trimmed)) {
    return "That looks like a NetID. Use a dyad or session code instead.";
  }
  return null;
}
