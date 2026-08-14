// Enforces the suite's core promise: the participant-facing PPS frontend is
// byte-identical with the standalone app it was imported from.
//
// Every file under src/station/ — EXCEPT src/station/remote/ (the Round Robin
// client added 2026-08-13, which is ours to adapt) — is hashed and compared
// against the committed manifest. CI runs this on every push; a mismatch
// means someone edited frozen study code, deliberately or not.
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

function currentManifest() {
  return walk(STATION)
    .map((file) => {
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
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
  console.log(`Station parity OK (${manifest.trimEnd().split("\n").length} frozen files).`);
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
  "\nThe station frontend is frozen: it must stay byte-identical with the standalone" +
    "\nPPS app (participant-facing study code). If this change is intentional and" +
    "\napproved, regenerate with: node scripts/verify-station-parity.mjs --update"
);
process.exit(1);
