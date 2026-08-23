import { useState } from "react";
import RemoteSettingsPanel from "../remote/RemoteSettingsPanel";
import type { AppSettings } from "../utils/settings";

// Everything the lab sets once per machine, on the dashboard rather than in the
// participant flow — an RA setting up a session should never have to think
// about any of it.
//
// The two "how the video task runs" switches that used to live here are gone
// (2026-08-22). Randy settled the shape of that task: every clip is judged for
// the participant and for their partner, in an order randomised per clip, and
// there is no average-student pass to combine or separate. A setting whose
// options no longer exist is worse than no setting.

interface FolderSettingsProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function FolderRow({
  label,
  help,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  help: string;
  value: string | null;
  placeholder: string;
  onChange: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value ?? "");

  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: label });
      if (selected) {
        setDraft(selected as string);
        onChange(selected as string);
      }
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  return (
    <div>
      <label className="block text-white text-lg mb-2">{label}</label>
      <div className="flex space-x-2">
        <input
          autoComplete="off"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(draft.trim() === "" ? null : draft.trim())}
          placeholder={placeholder}
          className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={browse}
          className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          Browse
        </button>
        {value && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onChange(null);
            }}
            className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-gray-400 text-sm mt-2">{help}</p>
    </div>
  );
}

export default function FolderSettings({ settings, onChange }: FolderSettingsProps) {
  return (
    <div className="space-y-6">
      <div className="bg-black border p-6 space-y-6">
        <h2 className="text-white text-xl font-bold">Folders on this machine</h2>

        <FolderRow
          label="Stimulus video folder"
          placeholder={"R:\\niedenthal\\stimuli\\mp4_noname"}
          value={settings.stimulusDir}
          onChange={(stimulusDir) => onChange({ ...settings, stimulusDir })}
          help="The clip library used by the video task. Leave empty to use the eight
                proof-of-concept clips built into the app. Clips are not part of the
                installer, so for the real study point this at the library on the
                Research Drive (or a local copy of it)."
        />

        <FolderRow
          label="Shared tracking folder"
          placeholder={"R:\\niedenthal\\pps-tracking"}
          value={settings.storeDir}
          onChange={(storeDir) => onChange({ ...settings, storeDir })}
          help="Where the round-robin file, today's session board and the live
                progress files live. Point every lab machine at one folder and this
                dashboard shows every session as it runs, including help requests
                — and both stations read the same nametag colours. Leave empty and
                this machine keeps its own private copy. It holds participant
                emails, so it belongs on the Research Drive — never a personal
                cloud folder (IRB 2020-1657)."
        />

        <FolderRow
          label="Session data folder"
          placeholder={"leave empty — pps-data on the Research Drive"}
          value={settings.dataDir}
          onChange={(dataDir) => onChange({ ...settings, dataDir })}
          help="Where each dyad's ratings.csv and transitions.csv folder is created.
                Empty is the right answer: the setup screen puts it in pps-data
                beside the recordings on the Research Drive, and no RA is asked to
                browse for a folder mid-session."
        />

        <p className="text-gray-400 text-sm">
          Changing the tracking folder takes effect immediately for new writes.
          Restart the app afterwards so everything is read from the same place.
        </p>
      </div>

      <RemoteSettingsPanel />
    </div>
  );
}
