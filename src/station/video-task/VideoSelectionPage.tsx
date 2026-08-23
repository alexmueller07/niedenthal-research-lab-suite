import { useState } from "react";
import StimulusPlayer from "./StimulusPlayer";
import ConfirmationModal from "../components/ConfirmationModal";
import { shuffle } from "../utils/shuffle";

// Final page of the video task: of the clips they just rated, which would they
// share with their partner, and which would they keep for themselves.
//
// Randy, 2026-08-05:
//   - the average-UW-student column is gone, along with that whole perspective.
//   - the two remaining columns swap places at random, per participant. They
//     are a forced comparison between "me" and "them", and a fixed left-right
//     order is a thumb on that scale: whichever column is read first is the one
//     answered most carefully. Which order was shown is written to the data
//     file, so the effect is testable rather than assumed away.
//
// Selecting nothing is allowed — an empty set is itself a response — but it
// prompts a confirmation so an accidental skip is caught.

export const COLUMN_DEFS = {
  self: { key: "self", header: "I would be interested" },
  partner: { key: "partner", header: "My conversation partner would be interested" },
} as const;

type ColumnKey = keyof typeof COLUMN_DEFS;

/** The two columns, left to right, as one participant saw them. */
export type ColumnOrder = [ColumnKey, ColumnKey];

export interface VideoSelectionResult {
  /** Clip ids the participant thinks their partner would be interested in. */
  forPartner: string[];
  /** Clip ids the participant would be interested in themselves. */
  forSelf: string[];
  /** The row order as presented, for the record. */
  presentedOrder: string[];
  /** The column order as presented, for the record. */
  columnOrder: ColumnOrder;
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
  // Drawn once, on mount, and never re-rolled: a column order that changed
  // under a participant mid-page would be worse than a fixed one.
  const [columnOrder] = useState<ColumnOrder>(
    () => shuffle(["self", "partner"] as ColumnKey[]) as ColumnOrder
  );
  const columns = columnOrder.map((key) => COLUMN_DEFS[key]);

  const [selected, setSelected] = useState<Record<ColumnKey, Set<string>>>({
    partner: new Set(),
    self: new Set(),
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
      presentedOrder: videoIds,
      columnOrder,
    });
  };

  const nothingSelected = selected.self.size === 0 && selected.partner.size === 0;

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          If you could share these videos, which ones do you think your partner
          would be interested in seeing, and which would you pick for yourself?
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-16 pb-8 max-w-6xl w-full mx-auto">
        <p className="text-white text-lg mb-6 text-center max-w-4xl">
          Tick every box that applies — as many or as few as you like. Click a
          video to watch it again.
        </p>

        <div className="w-full bg-black border p-6">
          <div className="flex items-end border-b border-white pb-3 mb-2">
            <span className="flex-1 text-white text-lg font-bold">Video</span>
            {columns.map((column) => (
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

              {columns.map((column) => (
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
            {columns.map((column) => (
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
