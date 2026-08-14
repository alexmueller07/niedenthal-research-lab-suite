import { useState } from "react";
import type { PublicSettings } from "../types";

interface Props {
  settings: PublicSettings | null;
  saving: boolean;
  onSave: (update: {
    roundRobinUrl?: string;
    roundRobinSecret?: string;
    researchDriveRoot?: string;
  }) => void;
  onPickDriveFolder: () => void;
}

/**
 * Machine-level configuration: where Round Robin lives, and where the Research
 * Drive is mounted on this particular computer.
 *
 * The shared secret is write-only from the interface's point of view. Rust never
 * sends it back — the panel only learns whether one exists — so a stray render
 * or a screenshot taken during a session cannot leak it. Leaving the field blank
 * keeps the stored secret; clearing it deliberately requires typing a space and
 * saving.
 */
export default function SettingsPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(props.settings?.roundRobinUrl ?? "");
  const [secret, setSecret] = useState("");
  const [drive, setDrive] = useState(props.settings?.researchDriveRoot ?? "");

  return (
    <section className="card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">Settings for this computer</span>
        <span className="text-xs text-[--color-ink-faint]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 border-t border-[--color-panel-edge] pt-3">
          <label className="field-label" htmlFor="rr-url">
            Round Robin address
          </label>
          <input
            id="rr-url"
            className="control"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://sc.psych.wisc.edu"
            spellCheck={false}
          />

          <label className="field-label mt-3" htmlFor="rr-secret">
            Shared secret
          </label>
          <input
            id="rr-secret"
            type="password"
            className="control"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              props.settings?.roundRobinSecretConfigured
                ? "Saved — leave blank to keep it"
                : "Not set"
            }
            spellCheck={false}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-[--color-ink-faint]">
            Matches PPS_SHARED_SECRET on the Round Robin server. Stored on this computer only
            and never displayed again.
          </p>

          <label className="field-label mt-3" htmlFor="drive">
            Research Drive folder
          </label>
          <div className="flex gap-2">
            <input
              id="drive"
              className="control font-mono text-xs"
              value={drive}
              onChange={(e) => setDrive(e.target.value)}
              placeholder="Z:\round-robin\recordings"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={props.onPickDriveFolder}
              className="shrink-0 rounded-lg border border-[--color-panel-edge] bg-[--color-panel] px-3 text-sm hover:border-[--color-ink-faint]"
            >
              Choose…
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[--color-ink-faint]">
            The same share the server's RECORDING_DIR points at. Recordings are written to
            local disk first and copied here afterwards, so a slow network cannot drop frames
            during a conversation.
          </p>

          <button
            type="button"
            disabled={props.saving}
            onClick={() =>
              props.onSave({
                roundRobinUrl: url.trim(),
                researchDriveRoot: drive.trim(),
                // Omitted when blank, so saving another field cannot wipe it.
                ...(secret.length > 0 ? { roundRobinSecret: secret } : {}),
              })
            }
            className="mt-4 rounded-lg bg-[--color-badger] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {props.saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </section>
  );
}
