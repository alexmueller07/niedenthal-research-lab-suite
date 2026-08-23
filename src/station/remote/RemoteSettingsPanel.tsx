import { useEffect, useState } from "react";

import { hasTauri, remoteConfigure, remoteStatus, remoteTest } from "./api";
import type { RemotePublic } from "./api";

// The Round Robin server connection, set once per machine on the dashboard —
// like the folder settings above it, an RA setting up a session never sees any
// of this.
//
// There is no device key field. Round Robin still authenticates every call the
// station makes; the key is compiled into the build rather than pasted per
// machine (src-tauri/src/machine.rs). The webview cannot leak a value it never
// receives, and now it cannot be asked for one either.

export default function RemoteSettingsPanel() {
  const [status, setStatus] = useState<RemotePublic | null>(null);
  const [url, setUrl] = useState("");
  const [driveRoot, setDriveRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!hasTauri()) return;
    void remoteStatus()
      .then((s) => {
        setStatus(s);
        setUrl(s.roundRobinUrl ?? "");
        setDriveRoot(s.driveIsShared ? (s.researchDriveRoot ?? "") : "");
      })
      .catch(() => setStatus(null));
  }, []);

  if (!hasTauri()) {
    return (
      <div className="bg-black border p-6">
        <h2 className="text-white text-xl font-bold mb-2">Round Robin server</h2>
        <p className="text-gray-400 text-sm">
          Available in the installed app only (this is the browser preview).
        </p>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const next = await remoteConfigure({
        roundRobinUrl: url.trim(),
        researchDriveRoot: driveRoot.trim(),
      });
      setStatus(next);
    } catch (err) {
      setTestResult({ ok: false, text: `Save failed: ${err}` });
    } finally {
      setSaving(false);
    }
  };

  const saveAndTest = async () => {
    await save();
    setSaving(true);
    try {
      setTestResult({ ok: true, text: await remoteTest() });
    } catch (err) {
      setTestResult({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        title: "Research Drive — the lab's recordings folder",
      });
      if (typeof picked === "string") setDriveRoot(picked);
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  return (
    <div className="bg-black border p-6 space-y-4">
      <h2 className="text-white text-xl font-bold">Round Robin server</h2>

      <div>
        <label className="block text-white text-lg mb-2">Research Drive folder</label>
        <div className="flex space-x-2">
          <input
            autoComplete="off"
            type="text"
            value={driveRoot}
            onChange={(e) => setDriveRoot(e.target.value)}
            placeholder={"R:\\niedenthal\\recordings"}
            spellCheck={false}
            className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={() => void browse()}
            className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Browse
          </button>
        </div>
        <p className="text-gray-400 text-sm mt-2">
          Where the recording rooms file finished conversations. This station
          copies the participant's video from here automatically, so nobody
          browses for a file mid-session.{" "}
          {status && !status.driveIsShared && (
            <span className="text-yellow-400">
              Not set — this station can only find conversations recorded on
              this same computer.
            </span>
          )}
        </p>
      </div>

      <details className="border border-gray-700 rounded-lg p-3">
        <summary className="cursor-pointer text-gray-400 text-sm">
          Advanced — server address
        </summary>
        <input
          autoComplete="off"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="the lab's server (already set)"
          spellCheck={false}
          className="mt-3 w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
        />
        <p className="text-gray-400 text-sm mt-2">
          Blank uses the lab's deployment. Change it when the UW server takes
          over.
        </p>
      </details>

      <button
        type="button"
        disabled={saving}
        onClick={() => void saveAndTest()}
        className="px-6 py-3 text-white text-lg border border-white bg-black hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? "Checking…" : "Save & test connection"}
      </button>

      {testResult && (
        <p className={`text-sm ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
          {testResult.text}
        </p>
      )}
    </div>
  );
}
