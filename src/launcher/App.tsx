import { useEffect, useState } from "react";

import {
  machineConfigure,
  machineFinishSetup,
  machineStatus,
  machineTest,
} from "./api";
import type { MachinePublic, RoleName } from "./api";

// The one screen an RA sets a lab machine up with — and the screen
// Ctrl+Alt+Shift+L reopens from any mode when something needs changing.
//
// Three shared values (server, secret, drive folder), one role, one test
// button that answers in plain words. Finishing restarts the app straight
// into the chosen role, and from then on the machine boots into it.

const ROLES: { id: RoleName; title: string; blurb: string }[] = [
  {
    id: "record",
    title: "Recording room",
    blurb:
      "Runs the Lab Recorder. For the conversation-room computers with the webcam.",
  },
  {
    id: "station",
    title: "Rating station",
    blurb:
      "Runs the PPS study app participants use. For the computer-room stations.",
  },
  {
    id: "control",
    title: "Control Center",
    blurb:
      "Shows the Round Robin session board. For an RA machine that watches the session.",
  },
];

export default function App() {
  const [status, setStatus] = useState<MachinePublic | null>(null);
  const [role, setRole] = useState<RoleName | null>(null);
  const [url, setUrl] = useState("");
  const [driveRoot, setDriveRoot] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void machineStatus()
      .then((s) => {
        setStatus(s);
        setUrl(s.roundRobinUrl ?? "");
        setDriveRoot(s.researchDriveRoot ?? "");
        const known = ROLES.find((r) => r.id === s.role);
        if (known) setRole(known.id);
      })
      .catch((e) => setNote({ ok: false, text: String(e) }));
  }, []);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setNote(null);
    try {
      const next = await machineConfigure({
        roundRobinUrl: url.trim(),
        researchDriveRoot: driveRoot.trim(),
        // Only send the secret when the field was touched; an untouched field
        // must not clear the stored one.
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
    }
  };

  const start = async () => {
    if (!role) return;
    if (!(await save())) return;
    setBusy(true);
    setNote({ ok: true, text: "Restarting into the chosen role…" });
    try {
      await machineFinishSetup(role);
    } catch (e) {
      setBusy(false);
      setNote({ ok: false, text: String(e) });
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
      <h1 className="text-2xl font-semibold">Machine setup</h1>
      <p className="mt-1 text-sm text-[--color-ink-dim]">
        Set once per computer. Reopen any time with Ctrl + Alt + Shift + L.
      </p>

      {status?.migratedFrom && (
        <p className="mt-4 rounded-lg border border-[--color-panel-edge] bg-[--color-panel] px-4 py-3 text-sm text-[--color-ink-dim]">
          Settings were imported from the standalone{" "}
          {status.migratedFrom === "lab-recorder" ? "Lab Recorder" : "PPS"} app
          on this machine — confirm them with <em>Save &amp; test</em> below.
        </p>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[--color-ink-dim]">
        What is this computer?
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            aria-pressed={role === r.id}
            className={`rounded-xl border p-4 text-left transition-colors ${
              role === r.id
                ? "border-[--color-ink] bg-[--color-panel]"
                : "border-[--color-panel-edge] hover:border-[--color-ink-dim]"
            }`}
          >
            <span className="block font-semibold">{r.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-[--color-ink-dim]">
              {r.blurb}
            </span>
          </button>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[--color-ink-dim]">
        Shared settings (same on every lab machine)
      </h2>
      <div className="mt-3 space-y-4 rounded-xl border border-[--color-panel-edge] bg-[--color-panel] p-5">
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
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveAndTest()}
          disabled={busy}
          className="rounded-lg border border-[--color-panel-edge] px-5 py-2.5 text-sm hover:border-[--color-ink-dim] disabled:opacity-50"
        >
          Save &amp; test connection
        </button>
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || !role}
          className="rounded-lg bg-[--color-badger] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {role
            ? `Start as ${ROLES.find((r) => r.id === role)?.title.toLowerCase()}`
            : "Pick a role to start"}
        </button>
        <span className="text-xs text-[--color-ink-dim]">
          Starting restarts the app into the role; it boots into it from then on.
        </span>
      </div>

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
