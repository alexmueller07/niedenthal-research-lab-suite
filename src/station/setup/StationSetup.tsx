import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FormData } from "../App";
import {
  NAMETAG_COLORS,
  colorHex,
  colorLabel,
  dyadsOn,
  loadBoard,
  nowHHMM,
  todayISO,
} from "../roundrobin/sessionBoard";
import type { DyadEntry, SessionBoard } from "../roundrobin/sessionBoard";
import { resolveDataDir } from "../utils/settings";
import type { AppSettings } from "../utils/settings";
import type { RemotePublic } from "../remote/api";

// The first screen in Rating Station mode: the RA sets the computer up, then
// hands it to the participant.
//
// This used to come *after* the participant had already signed in with their
// email, which the lab's walkthrough flagged immediately (Alex, 2026-08-22) —
// the participant sat down, typed their address, and then watched an RA lean
// over them to type study IDs into a form. Setup belongs before the handover,
// so it happens here, and the sign-in screen that follows is the only thing a
// participant ever sees first.
//
// Three things it will not make an RA do any more:
//   - hunt for the Research Drive: asked once per computer, then remembered.
//   - retype the dyad and both study IDs: read off the nametag colour the head
//     RA already assigned on the dashboard (see roundrobin/sessionBoard.ts).
//   - type today's date and the time: the computer knows both.

interface StationSetupProps {
  formData: FormData;
  settings: AppSettings;
  remote: RemotePublic | null;
  /** Persists a settings change (RA name, folders) for next time. */
  onSettingsChange: (settings: AppSettings) => void;
  /** Sets the Research Drive folder machine-wide. */
  onDriveChange: (path: string) => Promise<void>;
  onChange: (field: string, value: string) => void;
  onSubmit: () => void;
  /** Opens the researcher dashboard (session board, progress, folders). */
  onDashboard: () => void;
  /** Back to the mode chooser. */
  onLeaveMode: () => void;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const inputClass =
  "w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400";

/** IDs land in folder names, so no path-special characters. */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateId(value: string): string | null {
  if (!value.trim()) return "Required";
  if (!ID_PATTERN.test(value))
    return 'Only letters, numbers, underscores, and dashes allowed (no spaces or / \\ : * ? " < > |)';
  return null;
}

function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-white text-lg mb-2">{label}</label>
      <input
        autoComplete="off"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {error && <p className="text-red-400 text-xs mt-1 text-left">{error}</p>}
    </div>
  );
}

export default function StationSetup({
  formData,
  settings,
  remote,
  onSettingsChange,
  onDriveChange,
  onChange,
  onSubmit,
  onDashboard,
  onLeaveMode,
}: StationSetupProps) {
  const [board, setBoard] = useState<SessionBoard | null>(null);
  const [manual, setManual] = useState(false);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [idErrors, setIdErrors] = useState<Record<string, string | null>>({});
  const [attempted, setAttempted] = useState(false);
  const [driveDraft, setDriveDraft] = useState("");
  const [editingDrive, setEditingDrive] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  /** Files already sitting in this dyad's folder — see the guard below. */
  const [collision, setCollision] = useState<string[] | null>(null);

  const today = todayISO();
  const driveReady = Boolean(remote?.driveIsShared);
  const driveRoot = remote?.researchDriveRoot ?? null;

  useEffect(() => {
    void loadBoard().then(setBoard);
  }, []);

  // The clock knows the date and the time. Two fields that were typed by hand
  // into every session's data file, and every typo in them was permanent.
  useEffect(() => {
    if (!formData.sessionDate) onChange("sessionDate", today);
    if (!formData.sessionTime) onChange("sessionTime", nowHHMM());
    if (!formData.raName && settings.raName) onChange("raName", settings.raName);
    // Deliberately once, on mount: an RA who clears a field means it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where the session folder goes. Derived, not asked — the answer is always
  // "beside the recordings on the Research Drive".
  const dataDir = useMemo(
    () => resolveDataDir(settings, driveRoot),
    [settings, driveRoot]
  );
  useEffect(() => {
    if (dataDir && formData.saveFolder !== dataDir) onChange("saveFolder", dataDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataDir]);

  const todaysDyads = board ? dyadsOn(board, today) : [];

  const applyColor = (entry: DyadEntry, seat: "left" | "right", color: string) => {
    const here = seat === "left" ? entry.left : entry.right;
    const there = seat === "left" ? entry.right : entry.left;
    setPickedColor(color);
    onChange("dyadId", entry.dyadId);
    onChange("participantId", here.participantId);
    onChange("partnerId", there.participantId);
    onChange("computer", seat === "left" ? "Left" : "Right");
    if (entry.time) onChange("sessionTime", entry.time);
    setIdErrors({});
  };

  const idFields = ["dyadId", "participantId", "partnerId", "subjectInitials"] as const;

  const validate = () => {
    const errors: Record<string, string | null> = {};
    for (const f of idFields) errors[f] = validateId(formData[f]);
    setIdErrors(errors);
    return Object.values(errors).every((e) => e === null);
  };

  const missing: string[] = [];
  if (!formData.dyadId) missing.push("dyad");
  if (!formData.participantId) missing.push("participant ID");
  if (!formData.partnerId) missing.push("partner ID");
  if (!formData.subjectInitials) missing.push("initials");
  if (!formData.computer) missing.push("seat");
  if (!formData.raName) missing.push("RA name");
  if (!formData.saveFolder) missing.push("data folder");

  const start = () => {
    if (formData.raName !== settings.raName) {
      onSettingsChange({ ...settings, raName: formData.raName });
    }
    onSubmit();
  };

  /**
   * Checks whether this dyad's folder already holds data before starting.
   *
   * ratings.csv and transitions.csv are append-only, so a second session
   * written into an existing folder interleaves two participants' rows and
   * neither is recoverable. The folder name comes from the study IDs, so the
   * way to land in one that already exists is a mistyped ID or the wrong
   * nametag colour — both worth catching while the RA is still standing here,
   * and neither detectable afterwards.
   */
  const handleSubmit = () => {
    setAttempted(true);
    setCollision(null);
    if (missing.length > 0) return;
    if (!validate()) return;
    if (!hasTauri()) {
      start();
      return;
    }
    void invoke<string[]>("rating_directory_files", {
      basePath: formData.saveFolder,
      dyadId: formData.dyadId,
      participantId: formData.participantId,
      partnerId: formData.partnerId,
      initials: formData.subjectInitials,
    })
      .then((files) => {
        if (files.length > 0) setCollision(files);
        else start();
      })
      // A folder we cannot read is not a reason to block a session. The lab's
      // standing rule: never delay a session over a technical problem.
      .catch(() => start());
  };

  const saveDrive = async () => {
    setDriveBusy(true);
    setDriveError(null);
    try {
      await onDriveChange(driveDraft.trim());
      setEditingDrive(false);
    } catch (err) {
      setDriveError(String(err));
    } finally {
      setDriveBusy(false);
    }
  };

  const browseDrive = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        title: "Research Drive — the lab's recordings folder",
      });
      if (typeof picked === "string") setDriveDraft(picked);
    } catch (err) {
      setDriveError(`Folder picker failed: ${err}`);
    }
  };

  const showDriveEditor = editingDrive || !driveReady;

  return (
    <div className="w-full flex flex-col items-center bg-black cursor-auto min-h-screen overflow-y-auto py-10">
      <div className="w-full max-w-3xl px-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-white text-4xl font-bold">Set up this station</h1>
            <p className="text-gray-400 text-base mt-2">
              Researcher only. Hand the computer over once this is done.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0 ml-6">
            <button
              type="button"
              onClick={onDashboard}
              className="px-4 py-2 text-white text-sm border border-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              Researcher dashboard
            </button>
            <button
              type="button"
              onClick={onLeaveMode}
              className="px-4 py-2 text-gray-400 text-sm border border-gray-600 rounded-lg hover:border-white hover:text-white transition-colors"
            >
              ← Modes
            </button>
          </div>
        </div>

        {/* ---- 1. The Research Drive ---- */}
        <section className="border border-gray-700 rounded-lg p-5 mb-6">
          <h2 className="text-white text-xl font-bold mb-1">Research Drive</h2>
          <p className="text-gray-400 text-sm mb-4">
            Where the recording rooms file their conversations. This station
            copies the participant's video from here on its own, so nobody
            browses for a file mid-session. Set it once on this computer and it
            is remembered.
          </p>

          {!showDriveEditor ? (
            <div className="flex items-center gap-3">
              <span className="text-green-400 text-sm font-mono break-all">{driveRoot}</span>
              <button
                type="button"
                onClick={() => {
                  setDriveDraft(driveRoot ?? "");
                  setEditingDrive(true);
                }}
                className="shrink-0 px-3 py-1.5 text-gray-400 text-xs border border-gray-600 rounded hover:border-white hover:text-white transition-colors"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex space-x-2">
                <input
                  autoComplete="off"
                  type="text"
                  value={driveDraft}
                  onChange={(e) => setDriveDraft(e.target.value)}
                  placeholder={"R:\\niedenthal\\recordings"}
                  spellCheck={false}
                  className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => void browseDrive()}
                  className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Browse
                </button>
                <button
                  type="button"
                  disabled={driveBusy || driveDraft.trim() === ""}
                  onClick={() => void saveDrive()}
                  className="px-4 py-3 text-black bg-white rounded-lg font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  {driveBusy ? "Saving…" : "Save"}
                </button>
              </div>
              {!driveReady && (
                <p className="text-yellow-400 text-sm mt-3">
                  Not set yet. The station will still run, but it can only find
                  a conversation recorded on this same computer — a video from
                  the recording room next door will not appear.
                </p>
              )}
              {driveError && <p className="text-red-400 text-sm mt-2">{driveError}</p>}
            </>
          )}
        </section>

        {/* ---- 2. Who is sitting here ---- */}
        <section className="border border-gray-700 rounded-lg p-5 mb-6">
          <h2 className="text-white text-xl font-bold mb-1">Who is sitting here</h2>
          {!manual && todaysDyads.length > 0 ? (
            <>
              <p className="text-gray-400 text-sm mb-4">
                Tap the colour of this participant's nametag. The dyad and both
                study IDs come from the board the head RA set up this morning,
                so both stations use the same numbers.
              </p>
              <div className="flex flex-wrap gap-3">
                {todaysDyads.flatMap((entry) =>
                  (["left", "right"] as const).map((seat) => {
                    const color = entry[seat].color;
                    if (!color) return null;
                    const active = pickedColor === color;
                    return (
                      <button
                        key={`${entry.dyadId}-${seat}`}
                        type="button"
                        onClick={() => applyColor(entry, seat, color)}
                        className={`flex items-center gap-3 px-4 py-3 border rounded-lg transition-colors ${
                          active
                            ? "border-white bg-gray-800"
                            : "border-gray-600 hover:border-gray-300"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="w-6 h-6 rounded-full border border-white/40 shrink-0"
                          style={{ backgroundColor: colorHex(color) }}
                        />
                        <span className="text-left">
                          <span className="block text-white text-base">
                            {colorLabel(color)}
                          </span>
                          <span className="block text-gray-400 text-xs">
                            Dyad {entry.dyadId} · {seat === "left" ? "Left" : "Right"} seat ·
                            ID {entry[seat].participantId}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-4 text-gray-400 text-sm underline hover:text-white"
              >
                Not on the board — type it in instead
              </button>
            </>
          ) : (
            <>
              {todaysDyads.length === 0 && !manual && (
                <p className="text-yellow-400 text-sm mb-4">
                  Nothing on the board for today ({today}). Whoever hands out
                  the nametags can add today's dyads under{" "}
                  <button
                    type="button"
                    onClick={onDashboard}
                    className="underline hover:text-white"
                  >
                    Researcher dashboard
                  </button>
                  , and then both stations read the same numbers off a colour.
                  Until then, type them in.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Dyad ID"
                  value={formData.dyadId}
                  onChange={(v) => onChange("dyadId", v)}
                  error={attempted ? idErrors.dyadId : null}
                />
                <Field
                  label="Participant ID"
                  value={formData.participantId}
                  onChange={(v) => onChange("participantId", v)}
                  error={attempted ? idErrors.participantId : null}
                />
                <Field
                  label="Partner ID"
                  value={formData.partnerId}
                  onChange={(v) => onChange("partnerId", v)}
                  error={attempted ? idErrors.partnerId : null}
                />
                <div>
                  <label className="block text-white text-lg mb-2">Seat</label>
                  <div className="flex space-x-3">
                    {(["Left", "Right"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => onChange("computer", side)}
                        className={`flex-1 px-4 py-3 border border-white rounded-lg transition-colors ${
                          formData.computer === side
                            ? "bg-white text-black"
                            : "bg-gray-800 hover:bg-gray-700 text-white"
                        }`}
                      >
                        {side}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {todaysDyads.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManual(false)}
                  className="mt-4 text-gray-400 text-sm underline hover:text-white"
                >
                  ← Back to the nametag colours
                </button>
              )}
            </>
          )}

          {/* Always visible: what the colour picked, so a wrong tap is
              catchable before the participant sits down. */}
          {!manual && formData.dyadId && (
            <div className="mt-5 border-t border-gray-700 pt-4 grid grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Dyad</p>
                <p className="text-white">{formData.dyadId}</p>
              </div>
              <div>
                <p className="text-gray-500">This participant</p>
                <p className="text-white">{formData.participantId}</p>
              </div>
              <div>
                <p className="text-gray-500">Partner</p>
                <p className="text-white">{formData.partnerId}</p>
              </div>
              <div>
                <p className="text-gray-500">Seat</p>
                <p className="text-white">{formData.computer || "—"}</p>
              </div>
            </div>
          )}
        </section>

        {/* ---- 3. The rest ---- */}
        <section className="border border-gray-700 rounded-lg p-5 mb-6 space-y-4">
          <h2 className="text-white text-xl font-bold">This session</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Subject initials"
              value={formData.subjectInitials}
              onChange={(v) => onChange("subjectInitials", v)}
              error={attempted ? idErrors.subjectInitials : null}
              placeholder="AB"
            />
            <Field
              label="RA name"
              value={formData.raName}
              onChange={(v) => onChange("raName", v)}
              placeholder="Your name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Session date"
              value={formData.sessionDate}
              onChange={(v) => onChange("sessionDate", v)}
            />
            <Field
              label="Session time"
              value={formData.sessionTime}
              onChange={(v) => onChange("sessionTime", v)}
            />
          </div>
          <div>
            <label className="block text-white text-lg mb-2">Data folder</label>
            <p className="text-gray-400 text-sm font-mono break-all">
              {formData.saveFolder || "Not set"}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              A folder for this dyad is created inside it. Set by the Research
              Drive above — change it on the researcher dashboard if the lab
              ever wants it somewhere else.
            </p>
          </div>
        </section>

        {attempted && missing.length > 0 && (
          <p className="text-red-400 text-sm mb-4">
            Still needed: {missing.join(", ")}.
          </p>
        )}

        {collision && (
          <div className="border border-yellow-500 rounded-lg p-4 mb-4">
            <p className="text-yellow-400 text-base font-semibold">
              This dyad already has data on disk.
            </p>
            <p className="text-gray-300 text-sm mt-2">
              {formData.dyadId}_{formData.participantId}_{formData.partnerId}_
              {formData.subjectInitials} already contains{" "}
              {collision.slice(0, 4).join(", ")}
              {collision.length > 4 ? `, and ${collision.length - 4} more` : ""}.
              Usually that means a study ID is wrong or the nametag colour was
              mis-tapped. Starting anyway appends this session's rows to the same
              files, and the two participants cannot be separated afterwards.
            </p>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setCollision(null)}
                className="px-5 py-2 text-black bg-white rounded-lg font-semibold hover:bg-gray-200 transition-colors"
              >
                Let me check the IDs
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollision(null);
                  start();
                }}
                className="px-5 py-2 text-yellow-400 border border-yellow-500 rounded-lg hover:bg-yellow-500/10 transition-colors"
              >
                They are right — start anyway
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          className="w-full px-8 py-4 text-white text-xl border border-white bg-black hover:bg-gray-800 transition-colors"
        >
          Start — hand the computer to the participant
        </button>
        <p className="text-gray-500 text-xs text-center mt-3">
          The next screen asks the participant for their email. Nothing above is
          shown to them.
        </p>
      </div>
    </div>
  );
}

/** Exported for the dashboard's colour legend. */
export { NAMETAG_COLORS };
