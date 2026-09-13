import { useState } from "react";
import type { PublicSettings } from "../types";

interface Props {
  settings: PublicSettings | null;
  saving: boolean;
  onSave: (update: { roundRobinUrl?: string; researchDriveRoot?: string }) => void;
  onPickDriveFolder: () => void;
}

/**
 * Machine-level configuration: where the Research Drive is mounted on this
 * particular computer, and — behind a fold nobody opens — where Round Robin
 * lives.
 *
 * There is no device key here any more. Round Robin still authenticates every
 * call; the key ships inside the build instead of being pasted per machine
 * (see src-tauri/src/machine.rs). The lab's walkthrough was blunt about it:
 * a box labelled "shared secret" on a research app teaches an RA nothing and
 * costs a support call per install.
 */
export default function SettingsPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(props.settings?.roundRobinUrl ?? "");
  const [drive, setDrive] = useState(
    props.settings?.driveIsShared ? (props.settings?.researchDriveRoot ?? "") : ""
  );

  return (
    <section className="card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">Settings for this computer</span>
        <span className="text-xs text-(--color-ink-faint)">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 border-t border-(--color-panel-edge) pt-3">
          <label className="field-label" htmlFor="drive">
            Research Drive folder
          </label>
          <div className="flex gap-2">
            <input
              id="drive"
              className="control font-mono text-xs"
              value={drive}
              onChange={(e) => setDrive(e.target.value)}
              placeholder="R:\niedenthal\recordings"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={props.onPickDriveFolder}
              className="shrink-0 rounded-lg border border-(--color-panel-edge) bg-(--color-panel) px-3 text-sm hover:border-(--color-ink-faint)"
            >
              Choose…
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-(--color-ink-faint)">
            Where finished conversations end up, and where the rating stations
            look for them. Takes are written to this computer's disk first and
            copied here afterwards, so a slow network cannot drop frames during
            a conversation.
          </p>

          <details className="mt-3 rounded-lg border border-(--color-panel-edge) p-2.5">
            <summary className="cursor-pointer text-xs text-(--color-ink-faint)">
              Advanced — server address
            </summary>
            <input
              id="rr-url"
              className="control mt-2"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="the lab's server (already set)"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-(--color-ink-faint)">
              Blank uses the lab's deployment. Change it when the UW server
              takes over.
            </p>
          </details>

          <button
            type="button"
            disabled={props.saving}
            onClick={() =>
              props.onSave({
                roundRobinUrl: url.trim(),
                researchDriveRoot: drive.trim(),
              })
            }
            className="mt-4 rounded-lg bg-(--color-badger) px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {props.saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </section>
  );
}
