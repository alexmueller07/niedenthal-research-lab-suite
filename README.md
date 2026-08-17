# Niedenthal Lab Suite

One app for every lab computer. Install the same thing everywhere; every
launch opens on a chooser — pick what the computer is doing *right now*
(keys 1/2/3, or Enter for last time's choice):

| Role | What it runs | Which machines |
|---|---|---|
| **Recording room** | The Lab Recorder — frame-rate-exact webcam capture | Conversation rooms (Room 386) |
| **Rating station** | The PPS study app participants use | Computer room stations (Room 385) |
| **Control Center** | The Round Robin session board, in a window | Any RA machine |

The Round Robin website itself stays a website (participants sign up there
from home). The suite talks to it, files recordings for it, and frames it in
Control mode — one shared secret and one Research Drive folder, entered once
per machine.

## How the pipeline works

An RA presses Record in a conversation room and later presses Stop. The video
is verified frame by frame, checksummed, copied to the Research Drive, and
registered to the right session, room, and pair of participants. When those
participants sit down at rating stations and sign in, the station asks Round
Robin for their conversation, fetches it off the drive, re-checks the
checksum, and plays it. Nobody browses for files, and the control board
follows every station live.

If the network or the drive is down at any step, nothing blocks: recordings
queue and retry, stations fall back to the manual file picker. **Never delay
a session over a network problem.**

## Getting the app

Every push to `main` builds installers automatically: GitHub → **Actions** →
**Build installers** → newest green run → **Artifacts**. Download
`niedenthal-lab-suite-windows` (or `-macos` for the lab Mac).

Install it like any app (Windows will show "Windows protected your PC" —
More info → Run anyway; the app is unsigned). Silent install for many
machines: run the `-setup.exe` with `/S`.

## First run on a lab machine

The app opens on the mode chooser, with two live status chips up top — is
the Round Robin server reachable with this machine's secret, and is the
Research Drive mounted — probed fresh on every launch, so problems surface
before a session, not during one.

One-time, under **⚙ Settings**: enter the three shared values (identical on
every machine) — the Round Robin server address, the shared secret, and the
Research Drive recordings folder as mounted on this machine — then **Save &
test connection**, which answers in plain words. After that, using the app is
one click: pick the mode. Closing a mode brings the chooser back on next
launch; `Ctrl+Alt+Shift+L` reopens it from inside any mode.

If a standalone Lab Recorder or PPS app was installed on the machine before,
settings arrive pre-filled from it; confirm with the test button. The old
apps are untouched and keep working as a fallback.

## Day-to-day use

Exactly as the standalone apps — nothing an RA or participant sees has
changed:

- **Recording rooms:** camera/mic/quality, Preflight, Record/Stop, discreet
  mode (`Ctrl+Shift+R` reveals the controls, "Hide the screen again"
  re-covers). Today's session is preselected automatically and the room
  number is remembered per machine — a routine session needs zero dropdown
  clicks. Full guide:
  [docs/recorder/README-standalone.md](docs/recorder/README-standalone.md).
- **Rating stations:** participants sign in with their email; the RA fills
  the participant form; the conversation video loads by itself. Researcher
  save-and-quit stays `Ctrl+Shift+Q`. Guide:
  [docs/station/README-standalone.md](docs/station/README-standalone.md).
- **Control Center:** the Round Robin site, full screen. Log in as usual.

The participant-facing study screens are **frozen**: `src/station` ships
byte-identical with the standalone PPS app, and CI fails if any frozen file
changes (`npm run parity`). That is a deliberate guarantee, not an accident —
mid-study, the rating task must not drift.

## For developers

```bash
npm install                # also fetches the checksum-pinned FFmpeg sidecars
$env:SUITE_ROLE="record"   # or station / control / setup (debug builds only)
npm run tauri dev
npm test                   # frontend tests
cargo test --lib --manifest-path src-tauri/Cargo.toml
npm run parity             # confirm the frozen PPS frontend is untouched
npm run tauri build        # produce the installer
```

Layout: `src/launcher` (setup wizard) · `src/recorder` (Lab Recorder UI) ·
`src/station` (PPS UI, frozen) · `src-tauri/src/{machine,modes,shared,recorder,station}`.
Both imported apps' full git history is in this repo (`git log --follow`).
Engineering notes: [docs/recorder/DESIGN.md](docs/recorder/DESIGN.md).

## Status

- Built from the approved pipeline branches of the three standalone repos;
  those repos are frozen as fallback until Randy signs off on the suite.
- The macOS build has not run on the lab Mac yet.
- Coordinate with Ismam before changes that touch shared systems.

Questions: Alexander Mueller (admueller3@wisc.edu), CC Randy Lee
(randy.lee@wisc.edu).
