// Golden-output comparison: proves a scripted PPS session run in the suite's
// Station mode produces the same data files as the standalone PPS app.
//
//   node scripts/golden-compare.mjs <old-session-folder> <suite-session-folder>
//
// Each folder is one session's output (the {dyad}_{participant}_{partner}_
// {initials} folder holding ratings.csv and transitions.csv). Run the SAME
// scripted session in both apps first: same IDs, same seat, same demo clips,
// same answers, same clicks, in the same order.
//
// What "same" means per file — chosen to match what the data actually are:
//
// transitions.csv rows are event-driven (one row per answered item), so they
// must match exactly, column for column, EXCEPT the wall-clock columns
// (sessionTime, sessionDate, sessionTimestamp) — those differ between runs by
// construction.
//
// ratings.csv rows are wall-clock-driven (the 100 ms slider sampler), so two
// runs never produce identical rows. What must hold instead: identical
// header, identical session-constant columns, identical block structure
// (stopTime steps, Shift markers, trial numbers), and a row count in the same
// ballpark (the sampler ran at the same cadence for the same duration).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const [, , oldDir, suiteDir] = process.argv;
if (!oldDir || !suiteDir) {
  console.error("Usage: node scripts/golden-compare.mjs <old-session-folder> <suite-session-folder>");
  process.exit(1);
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL  ${msg}`);
};
const ok = (msg) => console.log(`ok    ${msg}`);

// Minimal CSV split that respects the quoting csvEscape produces.
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(dir, name) {
  const text = readFileSync(join(dir, name), "utf8").replaceAll("\r\n", "\n").trimEnd();
  const [header, ...rows] = text.split("\n");
  return { header, rows: rows.map(splitCsv) };
}

// ---- transitions.csv: exact modulo wall-clock columns ----------------------

{
  const IGNORE = new Set(["sessionTime", "sessionDate", "sessionTimestamp"]);
  const a = readCsv(oldDir, "transitions.csv");
  const b = readCsv(suiteDir, "transitions.csv");

  if (a.header !== b.header) fail(`transitions.csv headers differ:\n  old:   ${a.header}\n  suite: ${b.header}`);
  else ok("transitions.csv header identical");

  const columns = splitCsv(a.header);
  const keep = columns.map((c, i) => (IGNORE.has(c) ? -1 : i)).filter((i) => i >= 0);

  if (a.rows.length !== b.rows.length) {
    fail(`transitions.csv row counts differ: old ${a.rows.length}, suite ${b.rows.length}`);
  } else {
    let diffs = 0;
    a.rows.forEach((row, r) => {
      for (const i of keep) {
        if ((row[i] ?? "") !== (b.rows[r][i] ?? "")) {
          if (diffs < 5)
            fail(`transitions.csv row ${r + 2}, column ${columns[i]}: old "${row[i]}" vs suite "${b.rows[r][i]}"`);
          diffs++;
        }
      }
    });
    if (diffs === 0) ok(`transitions.csv identical across ${a.rows.length} rows (wall-clock columns aside)`);
    else if (diffs >= 5) fail(`…and ${diffs - 5} more transitions.csv differences`);
  }
}

// ---- ratings.csv: structure + constants + cadence --------------------------

{
  const a = readCsv(oldDir, "ratings.csv");
  const b = readCsv(suiteDir, "ratings.csv");
  const columns = splitCsv(a.header);
  const col = (name) => columns.indexOf(name);

  if (a.header !== b.header) fail(`ratings.csv headers differ:\n  old:   ${a.header}\n  suite: ${b.header}`);
  else ok("ratings.csv header identical");

  // Session-constant identity columns must agree everywhere.
  for (const name of ["SubID", "PartnerID", "dyad", "computer", "subjectInitials", "raName", "softwareVersion"]) {
    const i = col(name);
    if (i < 0) continue;
    const values = (rows) => [...new Set(rows.map((r) => r[i]))].sort().join("|");
    if (values(a.rows) !== values(b.rows))
      fail(`ratings.csv column ${name}: old {${values(a.rows)}} vs suite {${values(b.rows)}}`);
    else ok(`ratings.csv ${name} consistent (${values(a.rows)})`);
  }

  // Block structure: the stopTime ladder and Shift markers are protocol, not
  // wall clock — they must match exactly as ordered sets.
  for (const name of ["stopTime", "taskOrder"]) {
    const i = col(name);
    if (i < 0) continue;
    const seq = (rows) => [...new Set(rows.map((r) => r[i]))].join(",");
    if (seq(a.rows) !== seq(b.rows))
      fail(`ratings.csv ${name} ladder: old [${seq(a.rows)}] vs suite [${seq(b.rows)}]`);
    else ok(`ratings.csv ${name} ladder matches [${seq(a.rows)}]`);
  }
  const shiftCol = col("Shift");
  if (shiftCol >= 0) {
    const shifts = (rows) => rows.filter((r) => r[shiftCol] === "1").length;
    if (shifts(a.rows) !== shifts(b.rows))
      fail(`ratings.csv Shift markers: old ${shifts(a.rows)}, suite ${shifts(b.rows)}`);
    else ok(`ratings.csv Shift markers match (${shifts(a.rows)})`);
  }

  // Cadence: the sampler is wall-clock, so counts differ a little run to run.
  // More than 10% apart means sampling behavior changed — the thing the suite
  // must not do.
  const larger = Math.max(a.rows.length, b.rows.length);
  const delta = Math.abs(a.rows.length - b.rows.length);
  if (larger > 0 && delta / larger > 0.1)
    fail(`ratings.csv row counts too far apart: old ${a.rows.length}, suite ${b.rows.length} (${((delta / larger) * 100).toFixed(1)}%)`);
  else ok(`ratings.csv row counts comparable: old ${a.rows.length}, suite ${b.rows.length}`);
}

console.log("");
if (failures === 0) {
  console.log("GOLDEN OK — the suite's station output matches the standalone app.");
} else {
  console.error(`GOLDEN FAILED — ${failures} difference(s). Do not replace the standalone apps until this is clean.`);
  process.exit(1);
}
