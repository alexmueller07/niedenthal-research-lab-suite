import { useState } from "react";
import RemoteSettingsPanel from "../remote/RemoteSettingsPanel";
import type { AppSettings, VideoRatingMode } from "../utils/settings";

// Everything the lab sets once per machine, on the dashboard rather than in the
// participant flow — an RA setting up a session should never have to think
// about any of it.
//
// Two folders (where the clips are, where the tracking files go) and two
// switches for how the video task runs. The switches live here rather than in
// the source so the shape of the task can be changed and changed back in a
// meeting without a rebuild.

interface FolderSettingsProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function Choice({
  label,
  help,
  selected,
  onSelect,
}: {
  label: string;
  help: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex-1 border p-4 text-left transition-colors ${
        selected ? "border-white bg-gray-800" : "border-gray-600 hover:border-gray-400"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`h-4 w-4 shrink-0 rounded-full border-2 border-white ${
            selected ? "bg-white" : "bg-transparent"
          }`}
        />
        <span className="text-white text-lg">{label}</span>
      </span>
      <span className="mt-2 block text-gray-400 text-sm">{help}</span>
    </button>
  );
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
        help="Where the round-robin file and the live progress files live. Point
              every lab machine at one folder and this dashboard shows every
              session as it runs, including help requests. Leave empty and this
              machine keeps its own private copy. It holds participant emails, so
              it belongs on the Research Drive — never a personal cloud folder
              (IRB 2020-1657)."
      />

      <p className="text-gray-400 text-sm">
        Changing the tracking folder takes effect immediately for new writes.
        Restart the app afterwards so everything is read from the same place.
      </p>

      <div className="border-t border-gray-700 pt-6 space-y-6">
        <h2 className="text-white text-xl font-bold">How the video task runs</h2>

        <div>
          <label className="block text-white text-lg mb-3">Rating perspectives</label>
          <div className="flex gap-3">
            <Choice
              label="One at a time (current protocol)"
              help="Three passes over the clips: once for the participant, once for their
                    partner, once for an average UW–Madison student, in random order."
              selected={settings.videoRatingMode === "separate"}
              onSelect={() => onChange({ ...settings, videoRatingMode: "separate" })}
            />
            <Choice
              label="All three together"
              help="One pass. Every feeling is rated for all three people on the same
                    page. Faster, but the three ratings are visible to each other."
              selected={settings.videoRatingMode === "combined"}
              onSelect={() =>
                onChange({ ...settings, videoRatingMode: "combined" as VideoRatingMode })
              }
            />
          </div>
          <p className="text-gray-400 text-sm mt-2">
            Both modes write the same rows to the data file, and every session
            records which one it ran in. Set this the same way on both machines of a
            dyad.
          </p>
        </div>

        <div>
          <label className="block text-white text-lg mb-3">Rewatching clips</label>
          <div className="flex gap-3">
            <Choice
              label="Watch once, then optional"
              help="The first viewing of a clip is required. After that the participant
                    can replay it but does not have to."
              selected={!settings.requireRewatch}
              onSelect={() => onChange({ ...settings, requireRewatch: false })}
            />
            <Choice
              label="Watch again every time"
              help="Every clip must be played to the end in every pass. Roughly triples
                    the viewing time."
              selected={settings.requireRewatch}
              onSelect={() => onChange({ ...settings, requireRewatch: true })}
            />
          </div>
          <p className="text-gray-400 text-sm mt-2">
            Only applies to &ldquo;one at a time&rdquo;. How many times a clip was
            actually played before each rating is recorded either way.
          </p>
        </div>
      </div>
    </div>

    <RemoteSettingsPanel />
    </div>
  );
}
