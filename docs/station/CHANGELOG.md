# PPS App — Change Log

All changes are grouped by work session. Research-integrity notes call out anything
that affects collected data; those items require Randy's sign-off before being used
to collect real participant data.

---

## 2026-08-04 — Phase E: scale alignment, the unreachable rating page, un-kiosking

Three items from Alex's walkthrough, plus the full wording export Randy asked
for. No measurement changes — nothing on this list alters what is collected or
how it is scored.

### 1. Scale questions are centred over their circles

On the post-conversation page the question text was left-aligned against the full
width of the page frame while the row of circles was centred in a narrower
column, so on a wide screen the two read as unrelated. The question now sits
inside the same column as the circles.

- **Changed:** `src/components/NumberScale.tsx`.
- Affects all ten items on `PostConversation`, including the −5 … +5
  relative-talking item. Wording and values untouched.

### 2. The post-video writing screen could not be got off

⚠️ **This was blocking a session, not a cosmetic problem.** The writing +
elicitation screen (`RatingOverlay`) was a dead-centred flex column inside a
fixed-height, `overflow-hidden` parent. Once its content grew taller than the
window — which it does on any laptop-height screen — it was clipped at **both**
ends and could not be scrolled. The "Press Tab to continue" prompt sits at the
bottom, so it was the first thing to disappear: a participant on a short screen
saw a cut-off page with no visible way forward.

- **Changed:** `src/dyad-task/RatingOverlay.tsx`,
  `src/dyad-task/DyadTaskMain.tsx` (passes the submit handler down),
  `src/preview.tsx` (the screen is now in the dev preview).
- The overlay scrolls; content starts from the top when the window is short and
  only centres when there is room to spare.
- **Continue is now a real button**, pinned bottom-right like every other page
  in the app. Tab still submits — same handler, same behaviour — it is just no
  longer the only way through.
- Vertical padding trimmed (the 8 rem gap above the Likert, the 8 rem gap above
  the key prompt) so the page fits a 660 px viewport without scrolling at all.
- Verified at 1366×660 and 1280×560: top visible at rest, whole page reachable,
  Continue on screen and submitting.

### 3. The kiosk lock is gone (Randy + Alex, 2026-08-04)

The app is an ordinary window now. It can be minimized, resized, moved, and left
behind on another virtual desktop. Previously it was fullscreen, always-on-top,
undecorated and hidden from the taskbar, which meant it travelled with you across
desktops with no way out.

- **Changed:** `src-tauri/tauri.conf.json` — dropped `fullscreen`, `alwaysOnTop`,
  `skipTaskbar`; `decorations`, `resizable`, `maximizable`, `minimizable` and
  `closable` all true; opens `maximized` at 1440×900.
- **Changed:** `src-tauri/src/lib.rs` — the `setup` hook no longer forces
  fullscreen or always-on-top. The `enter_fullscreen` command and its
  Ctrl+Shift+F / Cmd+Shift+F global shortcut are removed: their only purpose was
  recovering the lock, and `enter_fullscreen` re-applied always-on-top, which
  would have reintroduced exactly the behaviour being removed.
- **Changed:** `src/App.tsx` — the in-page Ctrl+Shift+F fallback is removed.
- **Kept:** **Ctrl+Shift+Q / Cmd+Shift+Q** is unchanged. It is still the
  sanctioned way to end a session early, and still flushes buffered data before
  exiting.
- **Kept, with a change of route:** the window close button no longer silently
  refuses. `CloseRequested` now emits the same `admin-quit` event the shortcut
  does, so the X opens the Save & Quit gate. Closing the window would otherwise
  drop up to ~15 s of buffered slider samples; this keeps that guarantee while
  leaving the window genuinely closable.
- **Changed:** `src/utils/lockdown.ts` — F11 is no longer suppressed, since
  fullscreen is the operator's choice now. Reload (F5, Ctrl+R), dev tools and
  history navigation stay blocked: those destroy the in-memory state of a
  running session, which has nothing to do with kiosk mode.
- Verified on the running app: `WS_THICKFRAME`, `WS_MINIMIZEBOX`,
  `WS_MAXIMIZEBOX`, `WS_CAPTION` and `WS_SYSMENU` all set; `WS_EX_TOPMOST` and
  `WS_EX_TOOLWINDOW` both clear. Minimize, restore and resize all work, and
  WM_CLOSE leaves the process running with the Save & Quit gate open.

**Note for the lab machines:** nothing here was ever real kiosk protection — a
webview cannot suppress Alt+Tab or the Windows key. If participants must be kept
inside the app, that is Windows Assigned Access or Group Policy, as it always
was.

### 4. Full wording export (Randy)

- **New:** `docs/WORDING.md` — every string a participant sees, in order, from
  the check-in screen to "Please alert your researcher that you are finished",
  for the lab to review the wording. Ends with ten flagged wording questions
  (a typo, a stale cross-reference, a duplicated item, the sex field, and so on).

---

## 2026-08-02 — Phase D: review feedback from the 2026-07-29 lab meeting

Everything the group raised in the 2026-07-29 review thread (Randy, Ben, Reese,
Prior, Eddy, Sarah), plus Randy's separate walkthrough notes.

⚠️ **Measurement changes — need Randy's sign-off before live collection.** Three
items on this list change what gets collected, not just how it looks: the new
questionnaire at the front of the session, the writing + Likert screen that now
always follows the video, and the rewatch requirement being off by default. All
three are called out below.

### 1. Post-conversation questionnaire, at the very front (Randy)

⚠️ **New data.** Nine items on a 0–10 "Not at all / Very much" scale (affective
agency, predictability, conversation flow, enjoyment, friendship, comfort,
self-focus) plus the relative-talking item on its own −5 … +5 scale with a middle
anchor. Wording and scales are the paper instrument's, unchanged.

- **New:** `src/classification-task/PostConversation.tsx`,
  `src/components/NumberScale.tsx`.
- Runs **before the dyad task**, so before the participant has watched any of the
  conversation back. Everything later in the session reshapes how the
  conversation is remembered; these have to be asked first.
- Item order is **fixed, not shuffled** — it mirrors a paper instrument the lab
  has already run, and reordering would cost comparability for nothing.
- Rows are written to `transitions.csv` as `post_conversation` with the question
  text in `subTask` and a stable item key in `emotion1`, so analysis can join on
  the key rather than on prose.
- **New:** `src/utils/transitions.ts`. The `transitions.csv` writer moved out of
  `ClassificationTaskMain` and is now created once per session in `App.tsx`.
  Two independent writers would each have started `trialNumber` at 1, putting
  the same number twice in one file with nothing to order them by.

### 2. Conversation-rating (slider) task

- ⚠️ **The writing screen and the Likert now always run at the end**, whatever
  the video's length (Randy: a 3-minute clip ended the task with neither, so the
  directions were never seen). Previously only a video long enough to reach a
  150-second boundary got them. `DyadTaskMain` gained one end-of-video path
  (`handleVideoFinished` → final rating screen → `finishTask`) shared by all
  three end detectors, instead of three that each finished the task outright.
- **Perspective switches are much harder to miss** (Randy, twice; Prior; Ben):
  the announcement screen holds itself open for 6 seconds with a live countdown
  before any key advances it, and a boxed "You are rating: YOUR PARTNER'S
  FEELINGS" reminder now sits in the corner for the whole block. The parent
  key handler no longer advances the announcement — it was skipping past the
  screen it was meant to hold.
- **Slider labels line up now** (Randy, "the words on the slider still aren't
  centered"). The track lived in a 64rem box while the recorded value was a
  fraction of the *whole window*, so nothing lined up with anything. The bar is
  now full-width with the anchors at the true ends and a centre tick.
  **The recorded number is unchanged** — `pointer X / window width × 100`, still
  sampled every 100 ms. Only the drawing changed.
- **Timing hardening** (not raised, found while in there). The 100 ms sampler was
  being torn down and restarted on every parent re-render, and the parent was
  re-rendering ten times a second because each sample was written to React
  state. The latest value is a ref now, and the sampling loop holds `onSample` in
  a ref so it survives re-renders untouched.
- Instruction copy: "each block" → "each part of the video" (Reese), and
  YOU / YOUR PARTNER in caps throughout (Reese, Ben, Prior).

### 3. Video task

- ⚠️ **Rewatching is no longer required** in the second and third blocks
  (default changed). Ben, Sarah, Eddy and Prior all named the forced rewatch as
  the tedious part. The first viewing of a clip is still compulsory and the clip
  is still replayable on demand; `watch_plays` per trial still records whether a
  rating followed a fresh viewing, so the difference stays visible in analysis.
  Switchable from the dashboard.
- **Combined rating mode is built, and off** (Randy: "I need confirmation
  first"). **New:** `src/video-task/CombinedRatingPage.tsx` — one pass over the
  clips, every emotion rated for all three people on the same page, grouped by
  emotion. It writes exactly the same rows as the separate mode, and every
  session records which mode it ran in (`rating_mode`). Ben's objection — that
  seeing all three at once invites participants to norm their own answer against
  the average student — is the reason it ships off rather than on.
  Both switches live on the dashboard under "How the video task runs", so the
  shape of the task can be changed and changed back in a meeting.
- **Selection page**: third column, "The average UW–Madison student would like
  this" (Randy). The heading talked about *sending and picking* videos while the
  columns talked about *liking* them — Ben, Sarah and Eddy all flagged the
  mismatch, so the heading now says what the columns say. Rows say "▶ Watch
  again" rather than leaving the replay to be discovered.
- **Layout**: the clip is much bigger (Ben: it took the middle third while the
  ratings took nearly the full width), and there's a margin under the pinned
  header (Ben: the instruction sat outside where people were looking).
- The line "after the video you will be asked how strongly it evokes each of
  three feelings" is gone (Eddy) — it was already said before and after.
- "confident in that rating" → "confident in your answer" (Prior).
- Clips are explicitly unmuted on every play (Prior got silent clips): a webview
  that has ever blocked sound-on playback can leave the element muted, and
  playback then "works" with no audio and no error.

### 4. Everywhere

- **One wording for "you left something blank"** (Randy: the video task's was
  too informal). `ConfirmationModal` now defaults to the questionnaires'
  wording, so a new page gets it without anyone remembering to.
- **The help request can be turned off** (Randy). The participant can withdraw
  their own request ("I'm okay now"), and the dashboard gained a "clear all".
  Withdrawing resolves the request rather than erasing it, so an RA looking back
  at a session can still see it happened.
- **Fullscreen can be restored** with **Ctrl+Shift+F** / **Cmd+Shift+F** (Prior:
  once the window was windowed there was no way back). Handled at the OS level
  in Rust, because a window that isn't fullscreen is exactly the case where the
  page may not have keyboard focus; the in-page handler stays as a fallback.
- `preview.html` gained the post-conversation questionnaire, the perspective
  screen and the combined rating page, so any of them can be shown in seconds.

### Raised and deliberately not changed

- **"awe" may be misread** (Eddy). Agreed, but the emotion labels come from the
  clip library's annotations and changing one changes what the item measures.
  For Randy to decide.
- **Rate the partner first** (Eddy). Target order is randomized per participant
  and recorded; fixing partner-first would trade a randomization the design
  relies on for an ordering effect. Worth discussing, not worth doing quietly.
- **The Mac notepad hot corner** (Ben). Not an app bug — that's a macOS
  hot-corner setting, and the fix is on the machine. Noted in the README.

---

## 2026-07-23 — Phase C: video affective-response task; dashboard sees live progress

⚠️ **Measurement change — needs Randy's sign-off before live collection.** The
situational scenario task added in Phase B is replaced by a video task. The construct
is related (emotion intensity + confidence, for three targets) but the item is a film
clip instead of a written situation and the scale is **1–100 instead of 1–7**, so
these ratings are not directly comparable to Phase B data.

### 1. Video affective-response task (replaces the scenario task)

- **New files:** `src/video-task/videos.ts`, `StimulusPlayer.tsx`, `VideoWatchPage.tsx`,
  `VideoRatingPage.tsx`, `VideoSelectionPage.tsx`, `VideoTaskMain.tsx`,
  `videos.test.ts`.
- **Edited:** `src/classification-task/ClassificationTaskMain.tsx` (step `scenarios` →
  `videoTask`).
- **Retired, not deleted:** `scenarios.ts` and `components/ScenarioRating.tsx` are no
  longer reachable from the flow. Left in the tree so switching back is a one-line
  change if Randy wants the scenario task kept.

**Structure**, deliberately the same shape as the task it replaces: three targets
(yourself / your partner / an average UW-Madison student) in random order; the same
eight clips rated for each; clip order randomized within a target block; emotion order
randomized within a clip.

**Each trial is two pages.** Page 1 plays the clip — no native controls, so it cannot
be scrubbed, and **Continue is disabled until the clip has run to the end**. Page 2 is
the six questions: three emotions × (how strongly the clip evoked it, how confident the
participant is), on 1–100 sliders, all on one page. A "Replay video" button on page 2
opens the clip again and the number of replays is recorded.

**Clip sets.** Five premade sets of eight. A dyad is assigned one set by
`fnv1a(dyadId) mod 5` — both lab machines derive the same set from the Dyad ID typed on
their own participant form, so the pair is yoked with no communication between machines,
and the choice is reproducible from the data file. `SET_ASSIGNMENT_METHOD` is written
into the output next to the set id.

### Decisions (confirmed by Alex, 2026-07-23)

- **Clip 0494 probes disgust, fear and sadness** — three of the five emotions the
  library annotates it with. The other two (disappointment, anger) stay in the
  `annotated` field for the record but are not asked about.
- **Confidence is 1–100**, matching the intensity scale on the same page rather than the
  1–7 confidence used by the scenario task.
- **Sliders start at 50** with the value hidden until touched — same behaviour as
  `SelfFrequency`. Consistent with the rest of the app, and accepted as a midpoint
  anchor.
- **A full viewing is required in every target block** (`REQUIRE_FULL_WATCH_EACH_BLOCK`
  in `VideoTaskMain.tsx`), so each of the 24 ratings follows a fresh viewing rather than
  memory. Costs roughly 3× the viewing time; flip the constant to false only if pilot
  timing pushes the session past an hour.

### Still open for Randy

- **All five sets currently hold the same eight clips** (1615, 0494, 1097, 0027, 0366,
  0962, 0014, 1328) because the real groupings aren't chosen yet. The full study needs
  ≥40 unique clips. Swapping a set in is one line per set in `videos.ts`.
- **Instruction wording is a first draft.**

### 2. Video selection task

One page after the ratings: every clip they saw, with two checkbox columns — "My partner
would like this" and "I would like this". Clips can be replayed from the page. Selecting
nothing is allowed but asks for confirmation first.

### 3. Round-robin dashboard shows live progress and help requests

- **New files:** `src/roundrobin/progress.ts`, `ProgressPanel.tsx`, `FolderSettings.tsx`,
  `src/components/HelpButton.tsx`, `src/utils/settings.ts`, `src/utils/hash.ts`,
  `progress.test.ts`.
- **Edited:** `AdminDashboard.tsx`, `App.tsx`, `DyadTaskMain.tsx`, `lib.rs`,
  `tauri.conf.json`, `Cargo.toml`.

Every step change writes a small per-participant JSON file (`p-<hash>.json`, hashed so
emails don't appear in filenames) into a `progress` folder. The dashboard re-reads that
folder every 3 s and shows stage, current page, a session progress bar, and a red banner
for anyone who pressed the new **"Need help?"** button. One file per participant, not one
shared file, so two machines writing at once cannot overwrite each other.

**The help button is hidden during the dyad continuous rating.** The slider reads raw
mouse X (`Slider.tsx`), so a participant moving the pointer to a corner to click it would
be recorded as a "very negative" rating. `DyadTaskMain` now reports when the pointer is
the measurement and `App` hides the button for that whole period.

**Progress tracking never blocks a session:** a failed progress write is logged and
dropped. It is researcher convenience, not study data.

### 4. Shared tracking folder and stimulus folder

Two optional paths set on the dashboard and stored in `settings.json` in app data:
`storeDir` (round-robin + progress; point every machine at one Research Drive folder to
get a single live view) and `stimulusDir` (the clip library). Rust falls back to the
machine-local app-data folder if a configured folder is missing, so an unmounted
Research Drive cannot stop a session from starting.

The eight proof-of-concept clips are committed under `public/videos` (Alex's call,
2026-07-23, with the public-repo redistribution tradeoff in view), so a fresh clone and
both CI installers run with no setup. The full `mp4_noname` library stays gitignored;
the real study, which needs 40+ clips, points at it via the stimulus folder instead.
`npm run stimuli` refreshes `public/videos` when the demo set changes. Serving clips
from an arbitrary folder needed `protocol-asset` on the `tauri` crate plus an
`assetProtocol` scope in `tauri.conf.json`; verified in the built app by pointing it at
a folder of decoy clips named after the eight real ones and confirming the task played
the decoys.

### Output / data dictionary (no CSV schema change — reuses the existing columns)

Written to `transitions.csv` alongside the questionnaire rows.

| ratingTask | subTask | emotion1 | emotion2 | ratingPerson | response |
|---|---|---|---|---|---|
| `video_task` | `set_assignment` | | | | set id, e.g. `SET_C` |
| `video_task` | `set_assignment_method` | | | | `fnv1a(dyadId) mod 5` |
| `video_task` | `set_contents` | | | | the eight clip ids, `;`-joined |
| `video_task` | `target_order` | | | | the three targets, `;`-joined |
| `video_task` | `video_order` | | | target | clip order for that block, `;`-joined |
| `video_affect` | clip id | emotion | `intensity` | target | 1–100 |
| `video_affect` | clip id | emotion | `confidence` | target | 1–100 |
| `video_affect` | clip id | | `watch_plays` | target | completed viewings on the watch page |
| `video_affect` | clip id | | `first_watch_ms` | target | ms from page shown to end of first viewing |
| `video_affect` | clip id | | `rating_page_replays` | target | replays opened on the rating page |
| `video_selection` | `for_partner` / `for_self` | | | | selected clip ids, `;`-joined |
| `video_selection` | `n_for_partner` / `n_for_self` | | | | count |
| `video_selection` | `presented_order` | | | | row order as shown |

Long format, as before. Per participant: 3 targets × 8 clips × (3 emotions × 2 measures
+ 3 timing rows) = **216 `video_affect` rows**, plus 7 `video_task` and 5
`video_selection` rows.

### Verification

- `npm test` → 46/46 pass (31 new: set assignment, catalog integrity, clip-source
  resolution, progress files, stage maths, help-request state).
- `npx tsc --noEmit`, `npm run build`, `cargo check` → all pass.
- Driven end-to-end in a headless browser: all 24 trials plus both target transitions and
  the selection page; row counts and contents verified (216 / 7 / 5 as above). Confirmed
  Continue stays disabled until a clip finishes, and that a help request raised by a
  participant appears on the dashboard, clears from the dashboard, and the participant's
  notice then disappears on its own.
- **Not yet run on lab hardware.** Clip playback from a Research Drive path over the
  asset protocol, and the shared tracking folder across two machines, should both be
  tried on the actual lab machines before live use.

---

## 2026-06-10 — Phase B: situational scenarios replace the emotion-transition task

⚠️ **This is a measurement change and MUST be reviewed/approved by Randy before any
live data collection.** It replaces an existing construct (emotion-transition
likelihood, "how likely is X to become Y") with a new one (situational emotion
intensity + confidence). Data collected with this task is NOT comparable to any
pilot data from the old transition task.

### What changed
- **Removed:** the emotion-transition task — the 75-pair `emotionTransitions` array,
  the `EmotionsRating` component (deleted), and its 0–100% slider rating.
- **Added:** a situational scenario task (`scenarios.ts`,
  `components/ScenarioRating.tsx`). For each target the participant reads each
  situation and rates, per emotion, (a) intensity and (b) confidence, each on a
  **1–7** scale (1 = Not at all, 7 = Extremely).
- **Files:** `src/classification-task/scenarios.ts` (new),
  `src/classification-task/components/ScenarioRating.tsx` (new),
  `src/classification-task/ClassificationTaskMain.tsx` (edited),
  `src/classification-task/components/EmotionsRating.tsx` (deleted).

### Decisions (confirmed by Alex, 2026-06-10)
- **8 scenarios** (the mockup set, including "moving to a new city").
- **No progress counter** — the "scenario #N of 8" from the mockup was intentionally
  dropped, consistent with Phase A change #1 (don't show remaining progress).
- **Target-adapted prompts** — the situation is third person ("Imagine that a
  person…"); the emotion prompt adapts to who is being rated: "Rate the degree to
  which **you / your partner / an average UW-Madison student** would feel *angry*."
- **Confidence kept** — every emotion gets a 1–7 "How confident are you about your
  rating?" follow-up.

### Scenarios and their emotions (3rd-person wording)
| id | emotions |
|----|----------|
| stood_up_friend | angry, embarrassed, sad |
| goal_achieved | content, happy, pride |
| life_going_well | content, pride, happy |
| credit_stolen | sad, annoyed, angry |
| friend_moving | happy, anxious, sad |
| bug_in_food | angry, disgust, scared |
| new_city | happy, anxious, excited |
| speech_celebration | anxious, excited, scared |

### Randomization (method logged via row order; same approach as the rest of the app)
- **Target order** (yourself / your partner / average student): randomized — unchanged
  from before.
- **Scenario order**: randomized per target (`ScenarioRating` re-mounts per target via
  a React `key`, reshuffling).
- **Emotion order within a scenario**: randomized.
- Presentation order is recoverable from the row sequence + `trialNumber` +
  `sessionTimestamp` in the output (every rating is its own timestamped row).

### Output / data dictionary (no CSV schema change — reuses the existing columns)
Written to the same classification file (still named `transitions.csv`; it already
holds every classification sub-task, distinguished by `ratingTask`). Scenario rows:
- `ratingTask` = `emotion_scenarios`
- `subTask` = scenario id (e.g. `stood_up_friend`)
- `emotion1` = the rated emotion (e.g. `angry`)
- `emotion2` = the measure: `intensity` or `confidence`
- `ratingPerson` = `yourself` | `your partner` | `an average UW-Madison student`
- `response` = the 1–7 value
- `trialNumber` increments per write (captures presentation order)

This is **long format**: each emotion produces two rows (one `intensity`, one
`confidence`). 8 scenarios × 3 emotions × 2 measures × 3 targets = **144 rows** per
participant for this task.

### Instructions
The pre-task instructions were rewritten for the new task (1–7 scale, confidence,
three targets). **Draft wording — please review.**

### Wording to confirm with Randy
- `friend_moving` was completed to "…moving across the country **to start a new
  job**" (the short list entry was truncated; the mockup had the full clause).
- Instruction text is a first draft.

### Verification
- `npm run build` (tsc + vite) → passes.
- `npm test` → 6/6 pass (CSV regression unaffected).
- **Not yet interactively QA'd on device.** The full participant flow (instructions →
  3 targets × 8 scenarios, Tab-to-submit, completeness validation, between-target
  screens) should be clicked through on a lab machine before live use.

---

## 2026-06-10 — Phase A: kiosk hardening + data-safety (v2.0.0)

Four researcher-requested changes plus supporting infrastructure. No questionnaire
wording, scale, randomization, counterbalancing, or sampling-rate logic was changed
in this phase. (Phase B — replacing the emotion-transition task with situational
scenarios — is tracked separately and not part of this commit.)

### 1. Removed the progress indicator from the emotion-rating task
- **File:** `src/classification-task/components/EmotionsRating.tsx`
- **What:** Deleted the `Person X of Y · Transition N of M` label that was shown
  above each rating.
- **Why:** Seeing remaining count let participants gauge how much was left and rush
  to finish, degrading data quality.
- **Follow-on cleanup:** the `personIndex` and `totalPersons` props were now unused,
  so they were removed from `EmotionsRating`'s props/interface and from the call
  site in `ClassificationTaskMain.tsx`. No behavior change.
- **Research integrity:** none — purely a display element. Recorded data is identical.

### 2. Researcher-only "Save & Quit" gate (Ctrl+Shift+Q)
- **Files:** `src/components/AdminQuitModal.tsx` (new), `src/utils/flushRegistry.ts`
  (new), `src/App.tsx`, `src/dyad-task/DyadTaskMain.tsx`,
  `src-tauri/src/lib.rs`.
- **What:** Pressing **Ctrl+Shift+Q** opens a modal that requires the researcher to
  type the word **`Confirm`**. On confirm, the app flushes all data collected so far
  to disk and then exits. The participant is not told this shortcut exists, and the
  typed-word requirement prevents an accidental key combo from quitting a session.
- **Data safety — why the flush matters:** the dyad task buffers continuous slider
  samples in memory and only writes them to `ratings.csv` every 15 seconds
  (`DyadTaskMain` `sliderFlushRef`). A naive quit would lose up to ~15 s of samples.
  The new `flushRegistry` lets the active task register a flush callback; the quit
  handler `await`s `flushAll()` **before** calling the Tauri `exit_app` command, so
  in-progress data is persisted first.
- **Implementation notes:**
  - `flushRegistry.ts` — tiny register/`flushAll` module (uses `Promise.allSettled`
    so one failing flush doesn't block the others).
  - `DyadTaskMain` registers a flush that drains `sampleBufferRef` to disk.
  - `exit_app` (Rust command) calls `app.exit(0)`, which bypasses the close guard
    described in #3.
  - The modal's input stops keydown propagation so typing `Confirm` never reaches
    the task-level keyboard handlers running underneath.
- **Research integrity:** positive — reduces data loss on early termination. The
  flushed rows use the exact same format/columns as normal writes.

### 3. Prevent the participant from exiting the application
- **Files:** `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src/App.tsx`,
  `src/utils/lockdown.ts` (new).
- **What was added (the app can enforce these):**
  - Window flags: `fullscreen`, `alwaysOnTop`, `decorations: false`,
    `closable: false`, `minimizable: false`, `maximizable: false`,
    `resizable: false`, `skipTaskbar: true`.
  - Rust: `set_always_on_top(true)` and a `CloseRequested` guard that calls
    `api.prevent_close()` — this blocks Alt+F4 and the window close button. The only
    way out is the researcher Save & Quit gate (#2), which uses `app.exit(0)`.
  - In-app keyboard suppression (`lockdown.ts`, applied by a capture-phase listener
    in `App.tsx`): blocks reload (F5, Ctrl+R), dev tools (F12, Ctrl+Shift+I/J/C),
    fullscreen toggle (F11), close/quit (Ctrl+W, Ctrl+Q), print (Ctrl+P), find
    (Ctrl+F/G), zoom (Ctrl +/-/0), Ctrl+Tab, and Alt+←/→. Plain **Tab** and
    **Space** are deliberately NOT blocked — the study uses them to submit/advance —
    and normal typing in text fields is unaffected.
- **⚠️ Limit — what an app CANNOT block (must be done on the lab machines):**
  A webview application cannot reliably suppress true OS-shell gestures because the
  Windows shell handles them before the app sees the keystroke:
  - **Alt+Tab** (switch window)
  - **Windows key / Win+Tab** (Start, Task View)
  - **3-finger swipe up** (Task View) and **Win+D / Show Desktop**
  - **Ctrl+Alt+Del**

  To fully lock the study machines, configure Windows **Assigned Access (kiosk mode)**
  for the study user account, or a Group Policy that disables the Win key, Task View,
  and hot corners. This is a per-machine setup task, not something the app can do.
  *(If we decide we need it, a native low-level keyboard hook could suppress the Win
  key from inside the app, but it needs native code + testing on the actual lab
  hardware — flagged, not implemented.)*
- **Dev note:** because of always-on-top + prevent-close, during `npm run tauri dev`
  the window stays on top and won't close via the X. Quit it with the Save & Quit
  gate (Ctrl+Shift+Q → `Confirm`) or by stopping the dev terminal.
- **Research integrity:** none — collection logic untouched.

### 4. CSV is not broken by commas/quotes/newlines in free-text responses
- **Files:** `src/utils/csv.ts` (doc only), `src/utils/csv.test.ts` (new),
  `package.json`, `tsconfig.json`.
- **Finding:** the previous version broke columns when a free-text response
  contained a comma. **This is already fixed in the v2 rewrite** — every CSV row is
  built with `[...].map(csvEscape).join(",")`, and `csvEscape` wraps any field
  containing a comma/quote/newline in quotes (RFC 4180), doubles embedded quotes,
  and flattens newlines to spaces. Verified that all free-text inputs route through
  it: the dyad written report (`DyadTaskMain.buildRow`), and the `experience` /
  `studyFeedback` text fields (`ClassificationTaskMain.writeCSVRow`).
- **What was added:** a regression test (`csv.test.ts`, 6 cases incl. the
  comma-in-response column-break case) and the `npm test` script (Vitest). Test files
  are excluded from the production `tsc` build via `tsconfig.json`.
- **Research integrity:** positive — guarantees free-text responses can never shift
  data columns. Output format unchanged for comma-free values.

### Verification
- `npm test` → 6/6 pass.
- `npm run build` (tsc + vite) → passes, no type errors.
- `cargo check` (src-tauri) → passes.
- Not yet run on lab hardware. Manual kiosk/lockdown behavior should be verified on
  an actual study machine before live use.

### Pre-existing item still open (from the rewrite, not changed here)
- The `elapsedSec` column in `ratings.csv` was changed from `÷15000` to `÷1000`
  (correct ms→seconds) during the v2 rewrite. The Oct–Dec 2025 pilot used the old
  `÷15000` value, so this app's output won't match the pilot's elapsed-time scale.
  **Needs Randy's sign-off** before live collection. (Sampling cadence is unchanged.)
