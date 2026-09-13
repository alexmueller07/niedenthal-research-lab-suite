// Change detection for the participant-facing study code.
//
// This started as a byte-identity check against the standalone PPS app it was
// imported from. That promise ended on 2026-08-22, when Randy restructured the
// post-conversation video task; what the manifest guards now is weaker but
// still worth having — nobody edits a study screen by accident, or as a
// side-effect of a refactor, without the diff saying so out loud.
//
// Every file under src/station/ — EXCEPT src/station/remote/ (the Round Robin
// client added 2026-08-13, which is ours to adapt) — is hashed and compared
// against the committed manifest. CI runs this on every push; a mismatch
// means someone edited study code, deliberately or not.
//
//   node scripts/verify-station-parity.mjs            # verify (CI)
//   node scripts/verify-station-parity.mjs --update   # regenerate manifest
//
// Regenerating the manifest is an intentional, reviewable act: the diff shows
// exactly which frozen file changed, and the commit has to explain why. That
// is the point.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATION = join(ROOT, "src", "station");
const MANIFEST = join(ROOT, "scripts", "station-parity.sha256");
const EXCLUDED = ["remote"]; // top-level dirs under src/station exempt from freezing

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === STATION && EXCLUDED.includes(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Hash a study file by its content, with line endings normalised.
 *
 * Raw bytes were hashed until 2026-09-12, which made the check depend on the
 * checking machine's git config: with core.autocrlf=true the working copy is
 * CRLF, without it LF, and the same unmodified file hashes two different ways.
 * So the manifest only ever matched on a machine configured like the one that
 * generated it — this failed in CI while passing locally on the same commit,
 * and would fail for anyone on a Mac.
 *
 * Normalising is the right weakening. What this check guards, since byte
 * identity with the standalone PPS app ended on 2026-08-22, is that nobody
 * edits a participant-facing screen by accident or as a side effect of a
 * refactor. A line ending is not a study change, and a check that cries wolf
 * over one is a check people learn to regenerate without reading.
 */
function hashContent(file) {
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function currentManifest() {
  return walk(STATION)
    .map((file) => {
      const hash = hashContent(file);
      const rel = relative(STATION, file).replaceAll("\\", "/");
      return `${hash}  ${rel}`;
    })
    .sort((a, b) => a.split("  ")[1].localeCompare(b.split("  ")[1]))
    .join("\n");
}

const manifest = currentManifest() + "\n";

if (process.argv.includes("--update")) {
  writeFileSync(MANIFEST, manifest);
  console.log(`Wrote ${manifest.trimEnd().split("\n").length} entries to scripts/station-parity.sha256`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(MANIFEST, "utf8").replaceAll("\r\n", "\n");
} catch {
  console.error("scripts/station-parity.sha256 is missing. Generate it with --update.");
  process.exit(1);
}

if (committed === manifest) {
  console.log(`Station parity OK (${manifest.trimEnd().split("\n").length} study files unchanged).`);
  process.exit(0);
}

const parse = (text) =>
  new Map(
    text
      .trimEnd()
      .split("\n")
      .map((line) => [line.slice(66), line.slice(0, 64)])
  );
const want = parse(committed);
const have = parse(manifest);
for (const [file, hash] of have) {
  if (!want.has(file)) console.error(`ADDED (not in manifest): src/station/${file}`);
  else if (want.get(file) !== hash) console.error(`MODIFIED frozen file: src/station/${file}`);
}
for (const file of want.keys()) {
  if (!have.has(file)) console.error(`DELETED frozen file: src/station/${file}`);
}
console.error(
  "\nThese are participant-facing study screens. A change to one alters what a" +
    "\nparticipant sees or what gets recorded, so it has to be deliberate and it has" +
    "\nto be said out loud — that is what this check is for." +
    "\n\nIf the change is intentional and approved, regenerate the manifest with:" +
    "\n  node scripts/verify-station-parity.mjs --update" +
    "\nand describe the study change in the commit and in docs/station/CHANGELOG.md."
);
process.exit(1);
