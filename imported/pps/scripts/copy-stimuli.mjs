// Copies the proof-of-concept clips out of the lab's stimulus library into
// public/videos, which is where the app looks when no stimulus folder has been
// set on the dashboard.
//
// The eight proof-of-concept clips are committed, so a fresh clone already has
// them and this script is only needed when the demo set changes. The full
// library (mp4_noname) is not in git.
//
//   npm run stimuli                 # looks for ./mp4_noname
//   npm run stimuli -- D:\lab\clips # or point it somewhere else
//
// Which clips are copied comes from src/video-task/videos.ts, so adding a clip
// to a set is enough — this script picks it up.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(root, "mp4_noname"));
const destination = join(root, "public", "videos");

// videos.ts is TypeScript, so read the ids out of it rather than importing it.
const catalog = readFileSync(join(root, "src", "video-task", "videos.ts"), "utf8");
const ids = [...catalog.matchAll(/\{\s*id:\s*"(\d+)"/g)].map((match) => match[1]);

if (ids.length === 0) {
  console.error("No clip ids found in src/video-task/videos.ts — nothing to copy.");
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`Stimulus library not found: ${source}`);
  console.error("Pass the folder as an argument: npm run stimuli -- <folder>");
  process.exit(1);
}

mkdirSync(destination, { recursive: true });

let copied = 0;
const missing = [];
for (const id of ids) {
  const from = join(source, `${id}.mp4`);
  if (!existsSync(from)) {
    missing.push(id);
    continue;
  }
  copyFileSync(from, join(destination, `${id}.mp4`));
  copied += 1;
}

console.log(`Copied ${copied} of ${ids.length} clips into public/videos.`);
if (missing.length > 0) {
  console.error(`Missing from ${source}: ${missing.join(", ")}`);
  process.exit(1);
}
