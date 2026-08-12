# Lab Recorder — setup guide

Records conversation video from a webcam for Niedenthal Emotions Lab studies.
Works on Windows and macOS with any USB webcam; tuned for the Logitech BRIO.

It exists because the Windows Camera app produces video whose frames are not
evenly spaced in time. That sounds harmless and isn't: the PPS task lines up a
participant's mouse movements against video time, and uneven frames make that
line-up slowly slide out of place. Nobody would ever notice. This app forces
every frame onto an exact beat and then checks its own work afterwards.

**Maintaining the code?** See [docs/DESIGN.md](docs/DESIGN.md).

---

## Before you start

- A **USB webcam** plugged in. A laptop's built-in camera often will not work —
  Windows deliberately hides some of them from recording software. The app will
  tell you if that's what it's looking at.
- A **microphone**. The webcam's built-in one is fine.
- Somewhere to save. A **local drive** — not a network folder. The app copies to
  the Research Drive afterwards on its own.
- About **1 GB of free space per 10-minute recording** at the default quality.

---

## Install on Windows

1. Download `Lab Recorder_x.y.z_x64-setup.exe`.
2. Double-click it. Windows may show a blue **"Windows protected your PC"** box —
   this is expected, the app isn't signed with a paid certificate. Click **More
   info**, then **Run anyway**.
3. Accept the defaults. It installs to `C:\Program Files\Lab Recorder`.
4. Launch **Lab Recorder** from the Start menu.

The first time you record, Windows may ask for camera and microphone access.
Say yes — the app cannot record without it.

> Installing on several machines? Run `Lab Recorder_x.y.z_x64-setup.exe /S` from
> a terminal to install silently with no prompts.

---

## Install on macOS

macOS is stricter, so there are two extra steps. Do them in order.

1. Download `Lab Recorder_x.y.z_universal.dmg` and open it.
2. Drag **Lab Recorder** into your **Applications** folder.
3. **Do not double-click it yet.** Open Applications, **right-click** Lab
   Recorder, and choose **Open**. In the box that appears, click **Open** again.
   You only have to do this the first time — after that it opens normally.
4. macOS will ask for **camera** and then **microphone** access. Say yes to both.

**If macOS says the app "is damaged and can't be opened":** it isn't damaged.
That message appears for apps downloaded without an Apple developer signature.
Open Terminal and run:

```bash
xattr -dr com.apple.quarantine "/Applications/Lab Recorder.app"
```

Then open it again with right-click → Open.

**If the preview stays black and you were never asked about the camera:** macOS
denied access silently. Open **System Settings → Privacy & Security → Camera**,
switch Lab Recorder on, and restart the app. If Lab Recorder isn't in that list
at all, tell Alex — the app needs re-signing.

---

## First run: set it up

The setup screen has the live camera view on the left and the settings on the
right. Work down the right-hand column.

1. **Camera** — pick your webcam. If a note appears underneath it, read it; it's
   telling you something specific about that camera.
2. **Microphone** — pick one, and watch the green bar under the preview. **Talk.
   The bar must move.** If it doesn't, you have the wrong microphone or it's
   muted. A recording with silent audio looks completely normal until someone
   tries to use it.
3. **Quality** — leave it on **Lab Standard** unless Randy has told you
   otherwise. Each option shows exactly how much space it will use.
4. **Resolution and frame rate** — leave these alone. They're filled in from what
   your camera actually reported it can do.
5. **Save folder** — choose a folder on the local drive.
6. **Session code** — a dyad or session code. **Never a participant's name,
   email, or NetID.** The app will warn you if it spots one.
7. **Planned length** — how long the conversation will be. This is only used to
   predict file size and to set the safety stop.

Settings are remembered, so you only do this once per machine.

---

## Test it before a real session

**1. Run Preflight.** Scroll down to the Preflight box and click **Run check**.
It records five seconds with your exact settings, measures the result, throws it
away, and reports back. Every line should be green:

```
✓ Camera opens          150 frames captured
✓ Frame rate holds      30.0 fps delivered against 30 requested, 0 dropped
✓ Encoder keeps up      1.00x real time
✓ Microphone is live    -24.3 dBFS average
✓ Room on the drive     214 GB free, about 850 MB needed
```

A red line tells you what's wrong in plain words. Fix it and run it again.

**2. Record a real test.** Press the big red **RECORD** button (or `Ctrl+R`).
Talk and move around for about 30 seconds. Watch the counters — **Dropped**
should stay at 0.

**3. Stop.** Press the big square **STOP** button (or `Ctrl+S`). Wait a few
seconds while it finishes the file; don't close the window.

**4. Read the result.** You should see **"Recording verified"** and four ticks:

- Constant frame rate
- Frame timing exact
- Frame count matches the duration
- Audio present

If any of them is red, the recording has a real problem. The text says what it
is. Don't use the file for a study without asking Randy.

**5. Open the file.** Click **Show in folder** and play the `.mp4`. Next to it
you'll find a `.json` file with the same name — that's the receipt recording
which camera, which settings, how many frames were dropped, and a checksum.
Leave it there; it travels with the video.

---

## Running a real session

Same as the test, plus one step: before recording, pick the **session** and
**room** in the Round Robin box. That links the recording to the right pair of
participants and files it to the Research Drive automatically when you stop.

If Round Robin can't be reached, **record anyway**. The app says so, saves
locally, and files it automatically next time it can reach the server. Never
delay a session over this.

### Discreet mode

Tick **Discreet mode** if the study calls for it. While recording, the screen
shows a plain neutral message with no timer and no red indicator. Press
`Ctrl+Shift+R` to bring the controls back.

Be clear on what this does and does not do. It hides *the app's* indicators. It
**cannot** turn off the webcam's own light, the green dot on a Mac, or the
Windows "camera in use" indicator — no application can. Participants must still
have consented to being recorded under IRB 2020-1657.

Discreet mode also stops itself automatically 5 minutes after your planned
length, so a recording nobody can see can't be left running.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| **No cameras in the list** | The webcam isn't plugged in, or it's a built-in camera Windows hides from recording software. Plug in a USB webcam. |
| **"Windows doesn't expose this built-in camera…"** | Exactly that. Use a USB webcam. |
| **Preview is black / "Opening the camera…" forever** | Another app has the camera. Close Zoom, Teams, OBS, or the Camera app and click Rescan. |
| **"Signal lost — the camera stopped sending frames"** | The cable came loose or the camera reset. Reseat the USB cable. |
| **Microphone bar doesn't move** | Wrong microphone selected, or it's muted in the OS. Fix it before recording. |
| **"This camera cannot record at these settings"** | The camera doesn't support that combination. Pick a different resolution or frame rate from the dropdowns — they only list what it does support. |
| **Frames being dropped during recording** | The machine can't keep up. Stop, close other applications, and switch to the **Space Saver** preset. |
| **"Not enough free space"** | Free up disk space or pick a smaller preset. It won't let you start a recording it can't finish. |
| **Recording saved "with problems"** | Read the message. The file exists, but something is off. Ask Randy before using it. |
| **"N recordings waiting to be filed"** | Round Robin or the Research Drive was unreachable. Click **Retry now**, or leave it — it retries automatically. Nothing is lost. |

**If a session goes wrong technically:** note it in the session log and email
Randy (randy.lee@wisc.edu). Include the session code and what the finish screen
said.

---

## Building from source (developers only)

```bash
npm install          # also downloads + checksum-verifies the FFmpeg binaries
npm run tauri dev    # run it
npm test             # frontend tests
cargo test --lib --manifest-path src-tauri/Cargo.toml
npm run tauri build  # produce the installer
```

Installers land in `src-tauri/target/release/bundle/` — `nsis/` and `msi/` on
Windows, `dmg/` on macOS. macOS builds are produced by GitHub Actions (see
`.github/workflows/build-mac.yml`); Tauri cannot cross-compile them from Windows.

If the FFmpeg download fails, `npm run ffmpeg -- --use-system` copies whatever is
on your `PATH`. Development only — it prints a warning, because an unpinned build
breaks the guarantee that all three lab machines encode identically.

---

## Before this replaces the current workflow

- **Randy has to approve the default quality profile.** Switching from the
  Windows Camera app changes how data is collected, and that needs sign-off.
- **The macOS build has not been tested on the lab Mac yet.**
- **Coordinate with Ismam** before anything here touches shared systems.

Questions: Alexander Mueller (admueller3@wisc.edu), CC Randy Lee
(randy.lee@wisc.edu).
