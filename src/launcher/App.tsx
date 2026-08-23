import { useCallback, useEffect, useState } from "react";

import {
  forceCloseMode,
  launchMode,
  machineConfigure,
  machineHealth,
  machineSelfTest,
  machineStatus,
  machineTest,
  modeAlreadyRunning,
  quitSuite,
  runningMode,
} from "./api";
import type { CheckResult, MachineHealth, MachinePublic, RoleName } from "./api";

// The screen every launch opens on: pick what this computer is doing right
// now. Nothing is locked — the same machine can record this morning and be a
// control screen this afternoon. The one shared setting (the Research Drive
// folder) persists behind the gear; the status chips run their probes on every
// open so an RA sees a dead server or an unmounted drive BEFORE a session
// starts, not during one.
//
// Two things changed after the lab's walkthrough (2026-08-22):
//   - there is no "shared secret" to paste. Round Robin still authenticates
//     the app; the key now ships inside the build. Nothing to ask Alex for.
//   - a mode already running is no longer a dead end. This screen says which
//     one it is and switches to another, so nobody has to quit the app and
//     start it again to change what a computer is doing.

const ROLES: { id: RoleName; title: string; blurb: string; key: string }[] = [
  {
    id: "record",
    title: "Recording room",
    blurb: "Record a conversation. For the room computers with the webcam.",
    key: "1",
  },
  {
    id: "station",
    title: "Rating station",
    blurb: "Run the PPS study a participant sits down to.",
    key: "2",
  },
  {
    id: "control",
    title: "Control Center",
    blurb: "Watch the live session board on the Round Robin site.",
    key: "3",
  },
];

const roleTitle = (role: RoleName) => ROLES.find((r) => r.id === role)?.title ?? role;

/** How long to wait for a mode to close itself before offering to force it. */
const HANDOVER_PATIENCE_MS = 6000;

function Chip({ ok, label }: { ok: boolean | null; label: string }) {
  const tone =
    ok === null
      ? "border-(--color-panel-edge) text-(--color-ink-dim)"
      : ok
        ? "border-(--color-good)/40 bg-(--color-good)/10 text-(--color-good)"
        : "border-(--color-bad)/40 bg-(--color-bad)/10 text-(--color-bad)";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${tone}`}>
      <span aria-hidden>{ok === null ? "…" : "●"}</span>
      {label}
    </span>
  );
}

export default function App() {
  const [status, setStatus] = useState<MachinePublic | null>(null);
  const [health, setHealth] = useState<MachineHealth | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [launching, setLaunching] = useState<RoleName | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  // The mode running in another window, if any, and the handover in progress.
  const [openMode, setOpenMode] = useState<RoleName | null>(null);
  const [handover, setHandover] = useState<{ to: RoleName; impatient: boolean } | null>(null);

  // Settings drafts
  const [url, setUrl] = useState("");
  const [driveRoot, setDriveRoot] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void machineStatus()
      .then((s) => {
        setStatus(s);
        setUrl(s.roundRobinUrl ?? "");
        setDriveRoot(s.driveIsShared ? (s.researchDriveRoot ?? "") : "");
      })
      .catch((e) => setNote({ ok: false, text: String(e) }));
    setHealth(null);
    void machineHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    void runningMode()
      .then(setOpenMode)
      .catch(() => setOpenMode(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a mode is open in another window this screen is a remote control for
  // it, so it has to keep looking. Polling rather than an event because the
  // interesting transition — the other window going away — is exactly the case
  // where nothing is left to send one.
  useEffect(() => {
    if (!openMode && !handover) return;
    const id = window.setInterval(() => {
      void runningMode()
        .then((mode) => {
          setOpenMode(mode);
          if (handover && mode === handover.to) setHandover(null);
          if (!mode && handover) setHandover(null);
        })
        .catch(() => {});
    }, 700);
    return () => window.clearInterval(id);
  }, [openMode, handover]);

  // If the mode we asked to stand down is still there after a few seconds, it
  // is not going to answer (a frozen webview, or Control mode, which has no
  // way to hear us). Offer the blunt instrument, and say what it costs.
  useEffect(() => {
    if (!handover || handover.impatient) return;
    const id = window.setTimeout(
      () => setHandover((h) => (h ? { ...h, impatient: true } : h)),
      HANDOVER_PATIENCE_MS
    );
    return () => window.clearTimeout(id);
  }, [handover]);

  const launch = useCallback(
    (role: RoleName, force = false) => {
      if (launching) return;
      setLaunching(role);
      setNote(null);
      void launchMode(role, force)
        .then(() => {
          // A forced call means "the running mode has been asked to hand
          // over". The window it opens is not ours to wait for.
          if (force) setHandover({ to: role, impatient: false });
          setLaunching(null);
        })
        .catch((e) => {
          setLaunching(null);
          const running = modeAlreadyRunning(e);
          if (running) {
            setOpenMode(running);
            setNote(null);
          } else {
            setNote({ ok: false, text: String(e) });
          }
        });
    },
    [launching]
  );

  // 1/2/3 launch the modes; Enter launches the last-used one. Small, but an
  // RA opening this app four times a day feels it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSettings) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const byKey = ROLES.find((r) => r.key === e.key);
      if (byKey) launch(byKey.id, openMode !== null);
      if (e.key === "Enter" && status?.role) {
        const last = ROLES.find((r) => r.id === status.role);
        if (last) launch(last.id, openMode !== null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, status, launch, openMode]);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setNote(null);
    try {
      const next = await machineConfigure({
        roundRobinUrl: url.trim(),
        researchDriveRoot: driveRoot.trim(),
      });
      setStatus(next);
      return true;
    } catch (e) {
      setNote({ ok: false, text: `Save failed: ${e}` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAndTest = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      setNote({ ok: true, text: await machineTest() });
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
      void machineHealth().then(setHealth).catch(() => {});
      refresh();
    }
  };

  const browseDrive = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        title: "Research Drive — the lab's recordings folder",
      });
      if (typeof picked === "string") setDriveRoot(picked);
    } catch (e) {
      setNote({ ok: false, text: `Folder picker failed: ${e}` });
    }
  };

  const driveMissing = status !== null && !status.driveIsShared;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Niedenthal Lab Suite</h1>
          <p className="mt-1 text-sm text-(--color-ink-dim)">
            What is this computer doing right now?
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            aria-pressed={showSettings}
            className="rounded-lg border border-(--color-panel-edge) px-4 py-2 text-sm hover:border-(--color-ink-dim)"
          >
            {showSettings ? "Back to modes" : "⚙ Settings"}
          </button>
          {!openMode && (
            <button
              type="button"
              onClick={() =>
                void quitSuite().catch((e) => setNote({ ok: false, text: String(e) }))
              }
              className="rounded-lg border border-(--color-panel-edge) px-4 py-2 text-sm text-(--color-ink-dim) hover:border-(--color-bad) hover:text-(--color-bad)"
            >
              Quit
            </button>
          )}
        </div>
      </div>

      {/* Health, probed fresh on every open. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip
          ok={health === null ? null : health.serverOk}
          label={
            health === null
              ? "Checking the server…"
              : health.serverOk
                ? `Round Robin connected${
                    health.sessionCount !== null
                      ? ` — ${health.sessionCount} upcoming session${health.sessionCount === 1 ? "" : "s"}`
                      : ""
                  }`
                : `Round Robin problem — ${health.serverDetail ?? "unreachable"}`
          }
        />
        <Chip
          ok={health === null ? null : health.driveOk && !driveMissing}
          label={
            health === null
              ? "Checking the drive…"
              : driveMissing
                ? "Research Drive not set"
                : health.driveOk
                  ? "Research Drive mounted"
                  : "Research Drive NOT reachable"
          }
        />
        <button
          type="button"
          onClick={refresh}
          className="text-xs text-(--color-ink-dim) underline hover:text-(--color-ink)"
        >
          re-check
        </button>
        {/* The one button worth pressing before a session. Every failure this
            app has produced in testing was a precondition nobody could see
            until a session broke on it. */}
        <button
          type="button"
          onClick={() => {
            setChecking(true);
            setChecks(null);
            void machineSelfTest()
              .then(setChecks)
              .catch((e) => setNote({ ok: false, text: String(e) }))
              .finally(() => setChecking(false));
          }}
          disabled={checking}
          className="rounded-lg border border-(--color-panel-edge) px-3 py-1 text-xs hover:border-(--color-ink-dim) disabled:opacity-50"
        >
          {checking ? "Checking everything…" : "Check everything"}
        </button>
      </div>

      {checks && (
        <section className="mt-4 space-y-2 rounded-xl border border-(--color-panel-edge) bg-(--color-panel) p-4">
          <p className="text-sm font-semibold">
            {checks.every((c) => c.passed !== false)
              ? "Ready for a session."
              : "Fix these before running a session:"}
          </p>
          {checks.map((c) => (
            <div key={c.label} className="flex gap-2.5 text-xs leading-relaxed">
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  c.passed === false
                    ? "bg-(--color-bad) text-white"
                    : "bg-(--color-good) text-black"
                }`}
              >
                {c.passed === false ? "!" : "✓"}
              </span>
              <span>
                <span className="font-semibold">{c.label}</span>
                <span className="text-(--color-ink-dim)"> — {c.detail}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {/* One thing to set up on a fresh machine, and it is not a password. */}
      {driveMissing && !showSettings && (
        <section className="mt-4 rounded-xl border border-(--color-warn)/40 bg-(--color-warn)/10 p-4">
          <p className="text-sm font-semibold text-(--color-warn)">
            This computer is not pointed at the Research Drive yet.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-(--color-ink-dim)">
            Everything still works on this machine alone, but a recording made
            here cannot be found by a rating station on a different computer —
            and that is the whole point of the pipeline. Set it once and no
            RA has to think about files again.
          </p>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="mt-3 rounded-lg bg-(--color-badger) px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Set the Research Drive folder
          </button>
        </section>
      )}

      {/* A mode running in another window. This used to be a dead end: the
          launcher said "close it first" and gave no way to. */}
      {openMode && !showSettings && (
        <section className="mt-4 rounded-xl border border-(--color-panel-edge) bg-(--color-panel) p-4">
          <p className="text-sm font-semibold">
            {roleTitle(openMode)} is open in another window.
          </p>
          {handover ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-(--color-ink-dim)">
                Asking {roleTitle(openMode)} to save and hand over to{" "}
                {roleTitle(handover.to)}…
              </p>
              {handover.impatient && (
                <div className="mt-3">
                  <p className="text-xs leading-relaxed text-(--color-warn)">
                    It has not answered. Closing it from here skips its save
                    step — anything the last few seconds collected could be
                    lost. A running recording is never closed this way.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void forceCloseMode()
                        .then(() => setHandover(null))
                        .catch((e) => setNote({ ok: false, text: String(e) }))
                    }
                    className="mt-2 rounded-lg border border-(--color-bad) px-4 py-2 text-sm text-(--color-bad) hover:bg-(--color-bad)/10"
                  >
                    Close it anyway
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-(--color-ink-dim)">
              Pick a different card below to switch this computer over — it
              saves and closes on its own first. Closing that window also
              brings you back here.
            </p>
          )}
        </section>
      )}

      {status?.migratedFrom && !showSettings && (
        <p className="mt-4 rounded-lg border border-(--color-panel-edge) bg-(--color-panel) px-4 py-3 text-xs text-(--color-ink-dim)">
          Settings were imported from the standalone{" "}
          {status.migratedFrom === "lab-recorder" ? "Lab Recorder" : "PPS"} app —
          confirm them once under ⚙ Settings.
        </p>
      )}

      {!showSettings ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => launch(r.id, openMode !== null)}
                disabled={launching !== null || openMode === r.id || handover !== null}
                className={`rounded-xl border p-5 text-left transition-colors disabled:opacity-60 ${
                  status?.role === r.id
                    ? "border-(--color-ink) bg-(--color-panel)"
                    : "border-(--color-panel-edge) bg-(--color-panel) hover:border-(--color-ink-dim)"
                }`}
              >
                <span className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold">
                    {launching === r.id ? "Opening…" : r.title}
                  </span>
                  <kbd className="rounded border border-(--color-panel-edge) px-1.5 text-[10px] text-(--color-ink-dim)">
                    {r.key}
                  </kbd>
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-(--color-ink-dim)">
                  {r.blurb}
                </span>
                {openMode === r.id ? (
                  <span className="mt-3 block text-[10px] uppercase tracking-wide text-(--color-good)">
                    running now
                  </span>
                ) : (
                  status?.role === r.id && (
                    <span className="mt-3 block text-[10px] uppercase tracking-wide text-(--color-ink-dim)">
                      last used — Enter opens it
                    </span>
                  )
                )}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-(--color-ink-dim)">
            Closing a mode brings you straight back to this screen. From inside
            any mode, Ctrl + Alt + Shift + L opens it too.
          </p>
        </>
      ) : (
        <div className="mt-6 space-y-4 rounded-xl border border-(--color-panel-edge) bg-(--color-panel) p-5">
          <div>
            <p className="text-sm font-semibold">Research Drive folder</p>
            <p className="mt-1 text-xs leading-relaxed text-(--color-ink-dim)">
              The lab's share, as this computer sees it — a mapped letter like{" "}
              <span className="font-mono">R:\niedenthal\recordings</span>, or the
              full <span className="font-mono">\\research.drive.wisc.edu\…</span>{" "}
              path. Recording rooms write conversations here and rating stations
              read them back, which is how a station finds a participant's video
              with nobody browsing for files. Recordings are participant data
              under IRB 2020-1657 and belong nowhere else.
            </p>
          </div>
          <label className="block">
            <div className="mt-1 flex gap-2">
              <input
                autoComplete="off"
                type="text"
                value={driveRoot}
                onChange={(e) => setDriveRoot(e.target.value)}
                placeholder="R:\niedenthal\recordings"
                spellCheck={false}
                className="flex-1 rounded-lg border border-(--color-panel-edge) bg-black/40 p-2.5 font-mono text-xs outline-none focus:border-(--color-ink-dim)"
              />
              <button
                type="button"
                onClick={() => void browseDrive()}
                className="rounded-lg border border-(--color-panel-edge) px-4 text-sm hover:border-(--color-ink-dim)"
              >
                Browse
              </button>
            </div>
            <span className="mt-1 block text-xs text-(--color-ink-dim)">
              Leave it blank only for testing: recordings then stay in a folder
              on this computer and no other machine can reach them.
            </span>
          </label>

          {/* Here for the day the lab moves to the UW server, not for a first
              run. */}
          <details className="rounded-lg border border-(--color-panel-edge) p-3">
            <summary className="cursor-pointer text-sm text-(--color-ink-dim)">
              Advanced — server address
            </summary>
            <label className="mt-3 block">
              <span className="text-sm">Round Robin server address</span>
              <input
                autoComplete="off"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="the lab's server (already set)"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-(--color-panel-edge) bg-black/40 p-2.5 text-sm outline-none focus:border-(--color-ink-dim)"
              />
              <span className="mt-1 block text-xs text-(--color-ink-dim)">
                Leave blank to use the lab's deployment. Change it when the UW
                server takes over.
              </span>
            </label>
          </details>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void saveAndTest()}
              disabled={busy}
              className="rounded-lg bg-(--color-badger) px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Save &amp; test connection
            </button>
          </div>
        </div>
      )}

      {note && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm leading-relaxed ${
            note.ok
              ? "bg-(--color-good)/10 text-(--color-good)"
              : "bg-(--color-bad)/10 text-(--color-bad)"
          }`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
