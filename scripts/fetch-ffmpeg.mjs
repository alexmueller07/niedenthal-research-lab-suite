#!/usr/bin/env node
// Puts ffmpeg + ffprobe where Tauri expects sidecars: src-tauri/binaries/,
// named <tool>-<target-triple>[.exe].
//
// Why this exists rather than "install FFmpeg and put it on PATH": the whole
// point of this app is that three lab machines produce interchangeable files.
// Three hand-installed FFmpeg builds are three different encoders. This script
// pins one build per platform, verifies its checksum, and stamps the version
// into every recording manifest downstream.
//
// Usage:
//   node scripts/fetch-ffmpeg.mjs               fetch for the current platform
//   node scripts/fetch-ffmpeg.mjs --pin         fetch, then write the checksum
//                                               back into ffmpeg-manifest.json
//   node scripts/fetch-ffmpeg.mjs --use-system  copy whatever is on PATH instead
//                                               (dev only — breaks the parity
//                                               guarantee, and says so)
//   node scripts/fetch-ffmpeg.mjs --target aarch64-apple-darwin
//   node scripts/fetch-ffmpeg.mjs --target universal-apple-darwin
//                                               both Apple arches, lipo'd into
//                                               the single file a universal
//                                               bundle needs (macOS only)
//   node scripts/fetch-ffmpeg.mjs --all         every target in the manifest

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = join(HERE, "ffmpeg-manifest.json");
const OUT_DIR = join(ROOT, "src-tauri", "binaries");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** Tauri's sidecar naming uses the Rust target triple, so we need rustc's answer. */
function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.startsWith("host:"));
    if (line) return line.slice("host:".length).trim();
  } catch {
    // rustc missing is survivable — fall through to a platform guess.
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Recursive basename search — archive layouts differ between build providers. */
function findByName(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findByName(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function extract(archivePath, destDir, kind) {
  mkdirSync(destDir, { recursive: true });
  if (kind === "zip") {
    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
        ],
        { stdio: "inherit" }
      );
    } else {
      execFileSync("unzip", ["-q", "-o", archivePath, "-d", destDir], { stdio: "inherit" });
    }
    return;
  }
  // .tar.xz / .tar.gz — bsdtar on macOS and GNU tar on Linux both handle these.
  execFileSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
}

async function download(url) {
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Copies whatever ffmpeg/ffprobe are on PATH. Dev convenience, loudly caveated. */
function useSystem(triple) {
  const exe = process.platform === "win32" ? ".exe" : "";
  mkdirSync(OUT_DIR, { recursive: true });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    let src;
    try {
      src =
        process.platform === "win32"
          ? execFileSync("where", [tool], { encoding: "utf8" }).split(/\r?\n/)[0].trim()
          : execFileSync("which", [tool], { encoding: "utf8" }).trim();
    } catch {
      throw new Error(
        `--use-system was passed but ${tool} is not on PATH. Install FFmpeg or drop the flag.`
      );
    }
    const dest = join(OUT_DIR, `${tool}-${triple}${exe}`);
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
    console.log(`  ${tool} <- ${src}`);
  }
  console.warn(
    "\n  WARNING: --use-system copies an unpinned local build. Recordings made with\n" +
      "  it are NOT guaranteed to match the other lab machines. Use it for development\n" +
      "  only, never for a machine that will run a real session."
  );
}

async function fetchTarget(triple, spec, manifest) {
  const exe = triple.includes("windows") ? ".exe" : "";
  const ffmpegOut = join(OUT_DIR, `ffmpeg-${triple}${exe}`);
  const ffprobeOut = join(OUT_DIR, `ffprobe-${triple}${exe}`);

  if (existsSync(ffmpegOut) && existsSync(ffprobeOut) && !flag("force") && !flag("pin")) {
    console.log(`  already present — pass --force to refetch`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "labrec-ffmpeg-"));
  try {
    // Some providers ship one archive with both tools; others split them.
    const sources = [
      { url: spec.url, key: "sha256" },
      ...(spec.companion ? [{ url: spec.companion, key: "companionSha256" }] : []),
    ];

    for (const [i, source] of sources.entries()) {
      const buf = await download(source.url);
      const digest = sha256(buf);
      const pinned = spec[source.key];

      if (pinned && pinned !== digest) {
        throw new Error(
          `Checksum mismatch for ${source.url}\n` +
            `    expected ${pinned}\n` +
            `    got      ${digest}\n` +
            `  Upstream changed the build. Verify deliberately, then re-run with --pin.`
        );
      }
      if (!pinned) {
        console.log(`  sha256 ${digest}`);
        if (flag("pin")) {
          spec[source.key] = digest;
          writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
          console.log(`  pinned into ffmpeg-manifest.json`);
        } else {
          console.warn(`  not pinned yet — re-run with --pin to lock this build in`);
        }
      }

      // The extension is load-bearing on Windows: Expand-Archive refuses any
      // file not named *.zip, regardless of its actual contents.
      const kind = spec.archive ?? "zip";
      const ext = kind === "zip" ? ".zip" : ".tar";
      const archivePath = join(work, `src-${i}${ext}`);
      writeFileSync(archivePath, buf);
      extract(archivePath, join(work, `x-${i}`), kind);
    }

    for (const [tool, member] of Object.entries(spec.binaries)) {
      const found = findByName(work, member);
      if (!found) {
        throw new Error(
          `Extracted archive has no "${member}". Layout changed — inspect ${work} and ` +
            `update the "binaries" entry in ffmpeg-manifest.json.`
        );
      }
      const dest = join(OUT_DIR, `${tool}-${triple}${exe}`);
      copyFileSync(found, dest);
      chmodSync(dest, 0o755);
      console.log(`  ${tool} -> ${dest} (${(statSync(dest).size / 1e6).toFixed(0)} MB)`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The single sidecar a universal macOS bundle needs.
 *
 * `tauri build --target universal-apple-darwin` lipos its OWN binary, but it
 * does not do that for sidecars: it looks for `binaries/<tool>-universal-apple-
 * darwin` and fails the bundle outright if it is missing. Every macOS CI run
 * died there ("resource path `binaries/ffmpeg-universal-apple-darwin` doesn't
 * exist"), which is why no Mac installer has ever existed. (2026-08-18)
 */
const UNIVERSAL = "universal-apple-darwin";
const UNIVERSAL_PARTS = ["x86_64-apple-darwin", "aarch64-apple-darwin"];

async function fetchUniversal(manifest) {
  if (process.platform !== "darwin") {
    throw new Error(
      "a universal macOS sidecar can only be built on macOS — lipo is part of " +
        "the Xcode command line tools. This target is for the macOS CI job."
    );
  }

  const outputs = ["ffmpeg", "ffprobe"].map((tool) =>
    join(OUT_DIR, `${tool}-${UNIVERSAL}`)
  );
  if (outputs.every((p) => existsSync(p)) && !flag("force")) {
    console.log("  already present — pass --force to rebuild");
    return;
  }

  for (const part of UNIVERSAL_PARTS) {
    const spec = manifest.targets[part];
    if (!spec) throw new Error(`no ffmpeg-manifest.json entry for ${part}`);
    console.log(`  [${part}]`);
    await fetchTarget(part, spec, manifest);
  }

  for (const tool of ["ffmpeg", "ffprobe"]) {
    const dest = join(OUT_DIR, `${tool}-${UNIVERSAL}`);
    const parts = UNIVERSAL_PARTS.map((p) => join(OUT_DIR, `${tool}-${p}`));
    for (const p of parts) {
      if (!existsSync(p)) throw new Error(`missing ${p} — cannot build a universal binary`);
    }
    execFileSync("lipo", ["-create", "-output", dest, ...parts], { stdio: "inherit" });
    chmodSync(dest, 0o755);
    const archs = execFileSync("lipo", ["-archs", dest], { encoding: "utf8" }).trim();
    console.log(
      `  ${tool} -> ${dest} (${(statSync(dest).size / 1e6).toFixed(0)} MB, ${archs})`
    );
  }
}

/** Proves the binary actually runs here before the app depends on it. */
function smokeTest(triple, expectedVersion) {
  // A universal binary runs on whichever Mac built it, so it is testable even
  // though its triple never equals the host's.
  const runnable =
    triple === hostTriple() || (triple === UNIVERSAL && process.platform === "darwin");
  if (!runnable) return; // can't execute a cross-target binary
  const exe = triple.includes("windows") ? ".exe" : "";
  const bin = join(OUT_DIR, `ffmpeg-${triple}${exe}`);
  const out = execFileSync(bin, ["-version"], { encoding: "utf8" });
  const first = out.split("\n")[0].trim();
  console.log(`  ${first}`);
  if (expectedVersion && !first.includes(expectedVersion)) {
    console.warn(
      `  WARNING: manifest says FFmpeg ${expectedVersion} but this binary reports ` +
        `something else. Recordings will be stamped with what actually ran.`
    );
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const targets = flag("all")
  ? Object.keys(manifest.targets)
  : [opt("target") ?? hostTriple()];

for (const triple of targets) {
  console.log(`\n[${triple}]`);
  if (flag("use-system")) {
    useSystem(triple);
    continue;
  }
  if (triple === UNIVERSAL) {
    try {
      await fetchUniversal(manifest);
      smokeTest(triple, manifest.ffmpegVersion);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      process.exitCode = 1;
    }
    continue;
  }
  const spec = manifest.targets[triple];
  if (!spec) {
    console.warn(
      `  no entry in ffmpeg-manifest.json — add one, or run with --use-system for dev.`
    );
    process.exitCode = 1;
    continue;
  }
  try {
    await fetchTarget(triple, spec, manifest);
    smokeTest(triple, manifest.ffmpegVersion);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.error(
      `\n  The app will not record without these binaries. Either fix the URL in\n` +
        `  scripts/ffmpeg-manifest.json, or for local development run:\n` +
        `      npm run ffmpeg -- --use-system\n`
    );
    process.exitCode = 1;
  }
}
