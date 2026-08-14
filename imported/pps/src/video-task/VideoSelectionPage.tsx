import { useState } from "react";
import StimulusPlayer from "./StimulusPlayer";
import ConfirmationModal from "../components/ConfirmationModal";

// Final page of the video task: for each clip they just rated, who would like
// it — them, their partner, or the average UW–Madison student.
//
// All three judgments sit on one page, one row per clip, so the participant
// compares them for the same clip side by side rather than from memory two
// screens apart. Selecting nothing is allowed — an empty set is itself a
// response — but it prompts a confirmation so an accidental skip is caught.
//
// From the 2026-07-29 review:
//   - the average-student column is new (Randy).
//   - the heading used to talk about sending and picking videos while the
//     columns talked about liking them; Ben, Sarah and Eddy all flagged the
//     mismatch. The heading now says what the columns say.
//   - each row plays its clip back on click, which is what Randy was asking
//     for; the thumbnail now says so rather than leaving it to be discovered.

/** The three columns, in the order they are shown and recorded. */
const COLUMNS = [
  { key: "partner", header: "My partner would like this" },
  { key: "self", header: "I would like this" },
  { key: "average", header: "The average UW–Madison student would like this" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

export interface VideoSelectionResult {
  /** Clip ids the participant thinks their partner would like. */
  forPartner: string[];
  /** Clip ids the participant would like themselves. */
  forSelf: string[];
  /** Clip ids they think the average UW–Madison student would like. */
  forAverage: string[];
  /** The row order as presented, for the record. */
  presentedOrder: string[];
}

interface VideoSelectionPageProps {
  /** Clip ids in the order they should be shown (already randomized upstream). */
  videoIds: string[];
  srcFor: (id: string) => string;
  onSubmit: (result: VideoSelectionResult) => void;
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      aria-label={label}
      className={`w-8 h-8 border flex items-center justify-center text-lg font-bold transition-colors ${
        checked
          ? "bg-white text-black border-white"
          : "bg-black text-black border-gray-500 hover:border-white"
      }`}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

export default function VideoSelectionPage({
  videoIds,
  srcFor,
  onSubmit,
}: VideoSelectionPageProps) {
  const [selected, setSelected] = useState<Record<ColumnKey, Set<string>>>({
    partner: new Set(),
    self: new Set(),
    average: new Set(),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  const toggle = (column: ColumnKey, id: string) => {
    setSelected((prev) => {
      const next = new Set(prev[column]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [column]: next };
    });
  };

  /** Clip ids in presentation order, so the record keeps a stable order. */
  const chosen = (column: ColumnKey) => videoIds.filter((id) => selected[column].has(id));

  const submit = () => {
    setShowEmptyConfirm(false);
    onSubmit({
      forPartner: chosen("partner"),
      forSelf: chosen("self"),
      forAverage: chosen("average"),
      presentedOrder: videoIds,
    });
  };

  const nothingSelected = COLUMNS.every((c) => selected[c.key].size === 0);

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          For each video below, who do you think would like it?
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-16 pb-8 max-w-6xl w-full mx-auto">
        <p className="text-white text-lg mb-6 text-center max-w-4xl">
          These are the videos you just rated. Tick every box that applies — as many
          or as few as you like. Click a video to watch it again.
        </p>

        <div className="w-full bg-black border p-6">
          <div className="flex items-end border-b border-white pb-3 mb-2">
            <span className="flex-1 text-white text-lg font-bold">Video</span>
            {COLUMNS.map((column) => (
              <span
                key={column.key}
                className="w-48 text-white text-base font-bold text-center leading-tight"
              >
                {column.header}
              </span>
            ))}
          </div>

          {videoIds.map((id, index) => (
            <div
              key={id}
              className="flex items-center border-b border-gray-600 py-3"
            >
              <div className="flex-1 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setPreview(id)}
                  className="relative w-40 shrink-0 border border-gray-500 hover:border-white transition-colors"
                  aria-label={`Watch video ${index + 1} again`}
                >
                  {/* #t=1 asks the webview to render the one-second frame as a
                      still, so the row shows the clip rather than a black box. */}
                  <video
                    src={`${srcFor(id)}#t=1`}
                    preload="metadata"
                    muted
                    className="w-full h-24 object-cover bg-black pointer-events-none"
                  />
                  <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-white text-sm bg-black/40">
                    <span aria-hidden>▶</span> Watch again
                  </span>
                </button>
                <span className="text-white text-lg">Video {index + 1}</span>
              </div>

              {COLUMNS.map((column) => (
                <div key={column.key} className="w-48 flex justify-center">
                  <Checkbox
                    checked={selected[column.key].has(id)}
                    onChange={() => toggle(column.key, id)}
                    label={`${column.header} — video ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="flex items-center pt-4">
            <span className="flex-1 text-gray-400 text-base">Selected</span>
            {COLUMNS.map((column) => (
              <span key={column.key} className="w-48 text-gray-400 text-base text-center">
                {selected[column.key].size} of {videoIds.length}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="fixed bottom-8 right-8 z-40">
        <button
          type="button"
          onClick={() => (nothingSelected ? setShowEmptyConfirm(true) : submit())}
          className="px-8 py-3 rounded-lg font-semibold transition-colors bg-white text-black hover:bg-gray-200"
        >
          Continue
        </button>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-8">
          <div className="bg-black border border-white p-6 max-w-5xl w-full">
            <StimulusPlayer src={srcFor(preview)} compact onWatched={() => {}} />
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-6 py-2 text-white border border-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Back to the list
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={showEmptyConfirm}
        onClose={() => setShowEmptyConfirm(false)}
        onConfirm={submit}
        message="You haven't ticked any boxes on this page. Would you like to continue?"
      />
    </div>
  );
}
