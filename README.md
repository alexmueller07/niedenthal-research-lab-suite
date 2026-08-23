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
Control mode. There is exactly one thing to set on a new machine: the
Research Drive folder.

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
the Round Robin server reachable, and is the Research Drive mounted — probed
fresh on every launch, so problems surface before a session, not during one.

One-time, under **⚙ Settings**: point the machine at the **Research Drive
recordings folder** as it is mounted here (`R:\niedenthal\recordings`, or the
full `\\research.drive.wisc.edu\...` path), then **Save & test connection**,
which answers in plain words. That is the whole setup. The server address is
baked in and only needs changing when the UW server takes over.

After that, using the app is one click: pick the mode. Every mode has a
**← Modes** button, closing a mode window lands back on the chooser, and
`Ctrl+Alt+Shift+L` opens it from anywhere; picking a different card while a
mode runs asks that mode to save and hand over.

### Device authentication

The Round Robin API serves participant names, emails and schedules, so it
requires a bearer token on every call (IRB 2020-1657). Until 2026-08-22 that
token was a "shared secret" an RA pasted into Settings on each machine — it
authenticated correctly and nobody knew what it was, which made it the most
common reason a fresh install could not see a session.

It is now compiled into the build from `LAB_SUITE_DEVICE_KEY`, which the
release workflow passes from the repository secret of the same name. That
value must match `PPS_SHARED_SECRET` on the Round Robin deployment. No
interface shows it, asks for it, or can leak it — the public settings shapes
have no field for one.

Consequences worth knowing:

- **Builds made outside CI carry a development key** (`dev-local-only`) and
  will be refused by the production server. `Check everything` says so in
  those words rather than reporting a bare 401. To build a working installer
  locally, set `LAB_SUITE_DEVICE_KEY` before `npm run tauri build`.
- **Machines set up under the old scheme keep working.** A key already stored
  in `machine.json` wins over the built-in one and is never overwritten.
- **Rotating the key** means updating both the Vercel env var and the GitHub
  secret, then cutting a release. `LAB_SUITE_DEVICE_KEY` is also read from the
  environment at run time, as an escape hatch for the day that cannot wait.

If a standalone Lab Recorder or PPS app was installed on the machine before,
settings arrive pre-filled from it; confirm with the test button. The old
apps are untouched and keep working as a fallback.

## Day-to-day use

- **Recording rooms:** camera/mic/quality, Preflight, Record/Stop, discreet
  mode (`Ctrl+Shift+R` reveals the controls, "Hide the screen again"
  re-covers). Today's session is preselected automatically and the room
  number is remembered per machine — a routine session needs zero dropdown
  clicks. Full guide:
  [docs/recorder/README-standalone.md](docs/recorder/README-standalone.md).
- **Rating stations:** the RA sets the station up first — tap the nametag
  colour, everything else is filled in — then hands the computer over, and the
  participant signs in with their email. The conversation video loads by
  itself. Researcher save-and-quit stays `Ctrl+Shift+Q`. Guide:
  [docs/station/README-standalone.md](docs/station/README-standalone.md).
- **Control Center:** the Round Robin site, full screen. Log in as usual.

Before the day starts, whoever hands out the nametags fills in the **session
board** on the researcher dashboard: today's dyads, a colour per seat, and the
study ID that goes with it. Both stations then read the same numbers off a
colour, so no study ID is ever typed twice.

`npm run parity` hashes every file under `src/station` against a committed
manifest, and CI fails on a mismatch. It began life as a byte-identity check
against the standalone PPS app; that ended on 2026-08-22 when Randy
restructured the video task. What it guards now is weaker but still worth
having: nobody edits a study screen by accident, or as a side-effect of a
refactor, without the diff saying so. Regenerating the manifest
(`node scripts/verify-station-parity.mjs --update`) is a deliberate act and
the commit has to explain why.

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
- **The video task changed on 2026-08-22** to Randy's specification: two
  perspectives instead of three, an order drawn per clip, 1–7 scales. Data
  before and after are not comparable on those measures. See
  [docs/station/CHANGELOG.md](docs/station/CHANGELOG.md).
- **The continuous-rating task now starts on the perspective the protocol
  says it should** (odd study ID → own feelings). Every session before that
  date started on "self" regardless of seat. Randy needs to decide what that
  means for the pilot data.
- The macOS build has not run on the lab Mac yet.
- Coordinate with Ismam before changes that touch shared systems.

Questions: Alexander Mueller (admueller3@wisc.edu), CC Randy Lee
(randy.lee@wisc.edu).
