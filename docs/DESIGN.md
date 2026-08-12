# Lab Recorder — design and rationale

**Setting it up on a lab machine? Read [../README.md](../README.md) instead.**
This document is for whoever maintains the code: what it does, why it does it
that way, and what was measured rather than assumed.

The point of this app is one property: **frame *N* of the output is at exactly
*N*/fps seconds.** Everything else is in service of that, or of proving it
afterwards.

---

## Why it exists

The lab records conversations with the Windows Camera app. The lab's own
requirements note already flags the problem
(`notes/research/conversation-quality/11-Recording-Requirements.md:49`):

> Consumer webcam capture through the Windows Camera app is a known source of
> variable frame rate. Verify with `ffprobe -show_streams` on a pilot recording
> and transcode to CFR if needed.

That matters here more than it would elsewhere. The PPS empathic-accuracy score
aligns a rater's 100 ms slider trace against the target's own trace, both indexed
by video time. If the file's real frame timing drifts from its nominal timing,
the alignment drifts with it and the error lands in the dependent variable
without anything looking wrong.

A second reason: Round Robin's browser recorder writes `.webm`, and the PPS app
rejects it (`pps-app/src/dyad-task/DyadTaskMain.tsx:180` accepts only MP4 and
MOV). This writes MP4.

---

## Quick start

```bash
npm install          # also fetches + checksum-verifies the FFmpeg sidecars
npm run tauri dev    # run it
npm test             # frontend tests
cargo test --lib --manifest-path src-tauri/Cargo.toml
npm run tauri build  # installer
```

If the FFmpeg download fails, `npm run ffmpeg -- --use-system` will copy whatever
is on `PATH`. That is a development convenience and it prints a warning, because
an unpinned build breaks the guarantee that all three lab machines encode
identically.

---

## How it captures

The UI is a web frontend; capture is a bundled FFmpeg subprocess driven from
Rust. `MediaRecorder` cannot produce constant frame rate — it timestamps frames
as they arrive, drops them silently under load, and exposes no drop counter — so
it is the wrong instrument regardless of how convenient it is.

```
preflight → record (local, MKV) → stop via "q" → remux to MP4
  → ffprobe verify → sha256 → manifest
```

A few decisions worth knowing about:

| Decision | Reason |
|---|---|
| `-fps_mode cfr -r N` | The whole point. FFmpeg duplicates or drops frames to hold exactly N per second of wall time. |
| Input format chosen from the camera's own mode list | Most USB webcams fall to ~5 fps on their uncompressed modes at 1080p. Never assumed — probed. |
| Capture to MKV, remux to MP4 | An MP4 killed mid-write has no `moov` atom and is unrecoverable. MKV survives; the remux is `-c copy`. |
| Stop by writing `q` to stdin | A kill signal leaves the container unfinalized. Killing is the escalation after a timeout, not the mechanism. |
| `-progress pipe:1` | Machine-readable `drop_frames` / `dup_frames`. Scraping stderr is brittle across FFmpeg versions. |
| Preview fed by FFmpeg, not `getUserMedia` | On Windows a DirectShow camera is usually exclusive-access — a webview holding it would stop FFmpeg opening it at all. |
| `libx264` on both platforms | Hardware encoders differ per GPU vendor, which would defeat cross-machine consistency. |

### Any webcam, tuned for the BRIO

Nothing is hardcoded to the BRIO. Every camera is enumerated and its real
capability list probed; the resolution and frame-rate menus are built from that,
so the app can only ask for a mode the hardware advertised. A small profile table
(`src-tauri/src/devices.rs`, `PROFILES`) adds known-good ranking for cameras we
recognise — for the BRIO, MJPEG-first, because its uncompressed 1080p mode runs
near 5 fps.

The profile list is a *ranking*, not an allowlist. A camera offering only raw
formats still works; what actually keeps a camera off an unusable mode is the
frame-rate filter, which rejects any mode that never advertised the requested
rate.

---

## Measured behaviour

From a real capture on the development laptop (HP True Vision 5MP, nv12
1080p30 — a camera with no MJPEG mode at all, which makes it a good test of the
generic path):

| | Result |
|---|---|
| `r_frame_rate` / `avg_frame_rate` | `30/1` / `30/1` |
| Worst PTS deviation, direct MP4 | **0.000667 ms** against a 33.333 ms grid |
| Worst PTS deviation, MKV→MP4 remux | **0.667 ms** (Matroska quantises to its 1 ms timecode scale) |
| Force-killed capture | MKV recovered clean, remuxed, still `30/1` |

The crash-safe path therefore costs about 0.667 ms of timestamp quantisation.
That is under 1% of a single 100 ms slider sample, and a lost conversation cannot
be recovered at all, so `CrashSafeMkv` is the default. `DirectMp4` is available
when sub-millisecond timing matters more than surviving a crash.

---

## Verifying a recording yourself

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=r_frame_rate,avg_frame_rate,nb_frames \
  -show_entries format=duration -of json out.mp4

ffprobe -v error -select_streams v:0 -show_entries packet=pts_time -of csv=p=0 out.mp4
```

The app does this automatically on every take and writes the answer into the
`.json` manifest beside the video, along with the camera, its negotiated mode,
the FFmpeg build, dropped and duplicated frame counts, a SHA-256, and a settings
fingerprint. A recording that fails verification is marked suspect rather than
quietly passed.

### Cross-machine parity

`profileHash` in the manifest covers only the settings that determine what the
encoded file looks like — not device tokens or paths. Two recordings with the
same hash were produced the same way, so "did all three rooms record identically?"
is a string comparison rather than a matter of trust.

---

## Discreet mode

Recording without a salient on-screen indicator, for studies where a visible
"REC" banner is itself a confound. Participants have consented to being recorded
under IRB 2020-1657; what is suppressed is a reminder, not the fact.

**What cannot be suppressed by any application, and is not attempted here:** the
camera's own hardware activity LED, the macOS green camera indicator, and the
Windows "camera in use" indicator. All are enforced below the application layer.

Discreet mode forces a maximum duration, so a recording nobody can see cannot run
indefinitely. Controls return with `Ctrl + Shift + R`.

---

## Layout

```
src/                    React 19 + Vite 7 + Tailwind v4, TypeScript strict
  components/           preview, audio meter, presets, space readout, controls
  screens/              setup, record, finish
  presets.ts            quality tiers + size arithmetic
  naming.ts             filename rules (codes only, never identifiers)
src-tauri/src/
  devices.rs            enumeration, capability probing, device profiles
  ffmpeg.rs             argument construction — pure and tested
  recorder.rs           session lifecycle, progress parsing, graceful stop
  probe.rs              post-recording verification
  manifest.rs           the JSON receipt, checksums, profile hashing
  disk.rs               free space and size estimation
scripts/fetch-ffmpeg.mjs   pinned, checksum-verified sidecar download
```

---

## Before this replaces the current workflow

- **Confirm the default profile with Randy.** `CLAUDE.md`: *"Before changing any
  data collection logic, confirm with Randy — changes mid-study invalidate
  comparisons with pilot data."* Switching from the Windows Camera app is exactly
  that. "Lab Standard" is a proposal.
- **Test on the lab Mac.** The macOS path is built by CI but has not run on real
  hardware; the TCC/signing issue in `.github/workflows/build-mac.yml` is the
  concrete risk.
- **Loop in Ismam** before anything touching shared systems lands.
- FFmpeg with libx264 is GPL. Irrelevant for internal university use, worth one
  sentence to Randy before anything is published.
