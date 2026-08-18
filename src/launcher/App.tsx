import { useCallback, useEffect, useState } from "react";

import {
  launchMode,
  machineConfigure,
  machineHealth,
  machineSelfTest,
  machineStatus,
  machineTest,
} from "./api";
import type { CheckResult, MachineHealth, MachinePublic, RoleName } from "./api";

// The screen every launch opens on: pick what this computer is doing right
// now. Nothing is locked — the same machine can record this morning and be a
// control screen this afternoon. The shared settings (server, secret, drive)
// persist behind the gear; the status chips run their probes on every open so
// an RA sees a dead server or an unmounted drive BEFORE a session starts, not
// during one.

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

function Chip({ ok, label }: { ok: boolean | null; label: string }) {
  const tone =
    ok === null
      ? "border-[--color-panel-edge] text-[--color-ink-dim]"
      : ok
        ? "border-[--color-good]/40 bg-[--color-good]/10 text-[--color-good]"
        : "border-[--color-bad]/40 bg-[--color-bad]/10 text-[--color-bad]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${tone}`}>
      <span aria-hidden>{ok === null ? "…" : ok ? "●" : "●"}</span>
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

  // Settings drafts
  const [url, setUrl] = useState("");
  const [driveRoot, setDriveRoot] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void machineStatus()
      .then((s) => {
        setStatus(s);
        setUrl(s.roundRobinUrl ?? "");
        setDriveRoot(s.researchDriveRoot ?? "");
        // A machine with nothing configured opens straight onto settings —
        // there is nothing useful to launch yet.
        if (!s.roundRobinUrl && !s.secretConfigured) setShowSettings(true);
      })
      .catch((e) => setNote({ ok: false, text: String(e) }));
    setHealth(null);
    void machineHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const launch = useCallback(
    (role: RoleName) => {
      if (launching) return;
      setLaunching(role);
      setNote(null);
      void launchMode(role).catch((e) => {
        setLaunching(null);
        setNote({ ok: false, text: String(e) });
      });
    },
    [launching]
  );

  // 1/2/3 launch the modes; Enter launches the last-used one. Small, but an
  // RA opening this app four times a day feels it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSettings) return;
      const byKey = ROLES.find((r) => r.key === e.key);
      if (byKey) launch(byKey.id);
      if (e.key === "Enter" && status?.role) {
        const last = ROLES.find((r) => r.id === status.role);
        if (last) launch(last.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, status, launch]);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setNote(null);
    try {
      const next = await machineConfigure({
        roundRobinUrl: url.trim(),
        researchDriveRoot: driveRoot.trim(),
        ...(secretDraft !== "" ? { roundRobinSecret: secretDraft } : {}),
      });
      setStatus(next);
      setSecretDraft("");
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
    }
  };

  const browseDrive = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        title: "Research Drive recordings folder",
      });
      if (typeof picked === "string") setDriveRoot(picked);
    } catch (e) {
      setNote({ ok: false, text: `Folder picker failed: ${e}` });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Niedenthal Lab Suite</h1>
          <p className="mt-1 text-sm text-[--color-ink-dim]">
            What is this computer doing right now?
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-pressed={showSettings}
          className="rounded-lg border border-[--color-panel-edge] px-4 py-2 text-sm hover:border-[--color-ink-dim]"
        >
          {showSettings ? "Back to modes" : "⚙ Settings"}
        </button>
      </div>

      {/* Health, probed fresh on every open. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip
          ok={health === null ? null : health.configured && health.serverOk}
          label={
            health === null
              ? "Checking the server…"
              : !health.configured
                ? "Server not set up"
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
          ok={health === null ? null : health.driveConfigured && health.driveOk}
          label={
            health === null
              ? "Checking the drive…"
              : !health.driveConfigured
                ? "Research Drive not set up"
                : health.driveOk
                  ? "Research Drive mounted"
                  : "Research Drive NOT reachable"
          }
        />
        <button
          type="button"
          onClick={refresh}
          className="text-xs text-[--color-ink-dim] underline hover:text-[--color-ink]"
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
          className="rounded-lg border border-[--color-panel-edge] px-3 py-1 text-xs hover:border-[--color-ink-dim] disabled:opacity-50"
        >
          {checking ? "Checking everything…" : "Check everything"}
        </button>
      </div>

      {checks && (
        <section className="mt-4 space-y-2 rounded-xl border border-[--color-panel-edge] bg-[--color-panel] p-4">
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
                    ? "bg-[--color-bad] text-white"
                    : "bg-[--color-good] text-black"
                }`}
              >
                {c.passed === false ? "!" : "✓"}
              </span>
              <span>
                <span className="font-semibold">{c.label}</span>
                <span className="text-[--color-ink-dim]"> — {c.detail}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {status?.migratedFrom && !showSettings && (
        <p className="mt-4 rounded-lg border border-[--color-panel-edge] bg-[--color-panel] px-4 py-3 text-xs text-[--color-ink-dim]">
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
                onClick={() => launch(r.id)}
                disabled={launching !== null}
                className={`rounded-xl border p-5 text-left transition-colors disabled:opacity-60 ${
                  status?.role === r.id
                    ? "border-[--color-ink] bg-[--color-panel]"
                    : "border-[--color-panel-edge] bg-[--color-panel] hover:border-[--color-ink-dim]"
                }`}
              >
                <span className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold">
                    {launching === r.id ? "Opening…" : r.title}
                  </span>
                  <kbd className="rounded border border-[--color-panel-edge] px-1.5 text-[10px] text-[--color-ink-dim]">
                    {r.key}
                  </kbd>
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-[--color-ink-dim]">
                  {r.blurb}
                </span>
                {status?.role === r.id && (
                  <span className="mt-3 block text-[10px] uppercase tracking-wide text-[--color-ink-dim]">
                    last used — Enter opens it
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-[--color-ink-dim]">
            Closing a mode brings you back here on the next launch. From inside
            any mode, Ctrl + Alt + Shift + L reopens this screen.
          </p>
        </>
      ) : (
        <div className="mt-6 space-y-4 rounded-xl border border-[--color-panel-edge] bg-[--color-panel] p-5">
          <p className="text-sm text-[--color-ink-dim]">
            Shared settings — identical on every lab machine, entered once.
          </p>
          <label className="block">
            <span className="text-sm">Round Robin server address</span>
            <input
              autoComplete="off"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://sc.psych.wisc.edu"
              className="mt-1 w-full rounded-lg border border-[--color-panel-edge] bg-black/40 p-2.5 text-sm outline-none focus:border-[--color-ink-dim]"
            />
          </label>
          <label className="block">
            <span className="text-sm">Shared secret</span>
            <input
              autoComplete="off"
              type="password"
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              placeholder={
                status?.secretConfigured
                  ? "•••••• (configured — type to replace)"
                  : "Paste the PPS shared secret"
              }
              className="mt-1 w-full rounded-lg border border-[--color-panel-edge] bg-black/40 p-2.5 text-sm outline-none focus:border-[--color-ink-dim]"
            />
            <span className="mt-1 block text-xs text-[--color-ink-dim]">
              The same secret the Round Robin server holds. Stored on this
              machine only; never shown again after saving.
            </span>
          </label>
          <label className="block">
            <span className="text-sm">Research Drive recordings folder</span>
            <div className="mt-1 flex gap-2">
              <input
                autoComplete="off"
                type="text"
                value={driveRoot}
                onChange={(e) => setDriveRoot(e.target.value)}
                placeholder={"R:\\niedenthal\\round-robin\\recordings"}
                className="flex-1 rounded-lg border border-[--color-panel-edge] bg-black/40 p-2.5 text-sm outline-none focus:border-[--color-ink-dim]"
              />
              <button
                type="button"
                onClick={() => void browseDrive()}
                className="rounded-lg border border-[--color-panel-edge] px-4 text-sm hover:border-[--color-ink-dim]"
              >
                Browse
              </button>
            </div>
            <span className="mt-1 block text-xs text-[--color-ink-dim]">
              The recordings share, as mounted on this machine. Recording rooms
              file into it; rating stations fetch from it.
            </span>
          </label>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void saveAndTest()}
              disabled={busy}
              className="rounded-lg bg-[--color-badger] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
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
              ? "bg-[--color-good]/10 text-[--color-good]"
              : "bg-[--color-bad]/10 text-[--color-bad]"
          }`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
