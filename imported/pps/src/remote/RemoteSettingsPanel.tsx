import { useEffect, useState } from "react";

import { hasTauri, remoteConfigure, remoteStatus } from "./api";
import type { RemotePublic } from "./api";
import { invoke } from "@tauri-apps/api/core";

// The Round Robin server connection, set once per machine on the dashboard —
// like the folder settings above it, an RA setting up a session never sees
// any of this.
//
// The shared secret is written here and never read back: Rust stores it in
// remote.json and reports only whether one exists. That is deliberate — the
// webview cannot leak a value it never receives.

export default function RemoteSettingsPanel() {
  const [status, setStatus] = useState<RemotePublic | null>(null);
  const [url, setUrl] = useState("");
  const [driveRoot, setDriveRoot] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!hasTauri()) return;
    void remoteStatus()
      .then((s) => {
        setStatus(s);
        setUrl(s.roundRobinUrl ?? "");
        setDriveRoot(s.researchDriveRoot ?? "");
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
        // Only send the secret when the field was touched; an untouched field
        // must not clear the stored one.
        ...(secretDraft !== "" ? { roundRobinSecret: secretDraft } : {}),
      });
      setStatus(next);
      setSecretDraft("");
    } catch (err) {
      setTestResult({ ok: false, text: `Save failed: ${err}` });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTestResult(null);
    try {
      const text = await invoke<string>("remote_test");
      setTestResult({ ok: true, text });
    } catch (err) {
      setTestResult({ ok: false, text: String(err) });
    }
  };

  const browseDrive = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "Research Drive recordings folder" });
      if (selected) setDriveRoot(selected as string);
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  return (
    <div className="bg-black border p-6 space-y-6">
      <h2 className="text-white text-xl font-bold">Round Robin server</h2>
      <p className="text-gray-400 text-sm">
        Connects this rating station to the session board. With this set, the app
        finds each participant&rsquo;s conversation video by itself (recorded by Lab
        Recorder and filed to the Research Drive) and reports live progress to the
        Round Robin control page. Leave it empty and the app behaves exactly as
        before — manual video selection, no reporting.
      </p>

      <div>
        <label className="block text-white text-lg mb-2">Server address</label>
        <input
          autoComplete="off"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://sc.psych.wisc.edu"
          className="w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-white text-lg mb-2">Shared secret</label>
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
          className="w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
        />
        <p className="text-gray-400 text-sm mt-2">
          The same PPS_SHARED_SECRET the Lab Recorder machines use. Stored on this
          machine only; it is never shown again after saving.
        </p>
      </div>

      <div>
        <label className="block text-white text-lg mb-2">
          Research Drive recordings folder
        </label>
        <div className="flex space-x-2">
          <input
            autoComplete="off"
            type="text"
            value={driveRoot}
            onChange={(e) => setDriveRoot(e.target.value)}
            placeholder={"R:\\niedenthal\\round-robin\\recordings"}
            className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={browseDrive}
            className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Browse
          </button>
        </div>
        <p className="text-gray-400 text-sm mt-2">
          The same folder the server&rsquo;s RECORDING_DIR points at, as it is
          mounted on this machine. Conversation videos are copied from here (and
          checksum-verified) before playback, so a network hiccup can never stall
          a rating task mid-video.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-5 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={!status?.roundRobinUrl || !status?.secretConfigured}
          className="px-5 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          Test connection
        </button>
      </div>

      {testResult && (
        <p className={`text-sm ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
          {testResult.text}
        </p>
      )}
    </div>
  );
}
