/**
 * FNV-1a, 32-bit. A small, well-specified, non-cryptographic string hash.
 *
 * Used for two things in this app: deriving a stable video-set assignment from
 * a Dyad ID, and deriving a stable filename from a participant email. Never for
 * anything security-related — it is not a cryptographic hash and does not hide
 * the input from anyone who can guess it.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619, kept in the 32-bit unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Zero-padded 8-character hex form, for use in filenames. */
export function fnv1aHex(input: string): string {
  return fnv1a(input).toString(16).padStart(8, "0");
}
