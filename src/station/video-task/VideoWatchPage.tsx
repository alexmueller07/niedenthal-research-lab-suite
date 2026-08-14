import { useState } from "react";
import StimulusPlayer from "./StimulusPlayer";
import type { WatchStats } from "./StimulusPlayer";

// Page 1 of each trial: watch the clip.
//
// Nothing to answer here. Continue is disabled until the clip has run to the end
// at least once — unless this clip was already watched in an earlier block and
// the rewatch requirement is off, which is the default since 2026-07-30.
//
// Layout changes from the 2026-07-29 review:
//   - the clip is much bigger. It used to occupy about the middle third of the
//     screen while the rating page ran nearly the full width (Ben).
//   - a margin under the pinned header, because the instruction sat outside
//     where people were looking (Ben).
//   - the line "after the video you will be asked how strongly it evokes each
//     of three feelings" is gone: the same thing is said in the instructions
//     before, and again on the next page (Eddy).

interface VideoWatchPageProps {
  src: string;
  /** e.g. "Video 3 of 8". */
  positionLabel: string;
  /**
   * Whose perspective this block is about, in caps, or null in combined mode
   * where a single page covers all three.
   */
  targetReminder: string | null;
  /** Set when a previous block already required a full viewing of this clip. */
  alreadyWatchedEarlier: boolean;
  /** When true, a full viewing is required in every block, not just the first. */
  requireWatch: boolean;
  onWatched: (stats: WatchStats) => void;
  onContinue: () => void;
}

export default function VideoWatchPage({
  src,
  positionLabel,
  targetReminder,
  alreadyWatchedEarlier,
  requireWatch,
  onWatched,
  onContinue,
}: VideoWatchPageProps) {
  const [watched, setWatched] = useState(false);

  const gateSatisfied = watched || (!requireWatch && alreadyWatchedEarlier);

  const handleWatched = (stats: WatchStats) => {
    setWatched(true);
    onWatched(stats);
  };

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          {alreadyWatchedEarlier && !requireWatch
            ? "You have seen this video before. Watch it again if you would like to."
            : "Please watch the following video all the way through."}
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-24 pb-8 w-11/12 max-w-6xl mx-auto">
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-gray-400 text-base">{positionLabel}</span>
          {targetReminder && (
            <span className="border border-white px-4 py-1.5 text-white text-base">
              You are rating: <span className="font-bold">{targetReminder}</span>
            </span>
          )}
        </div>

        <StimulusPlayer src={src} onWatched={handleWatched} />
      </div>

      <div className="fixed bottom-8 right-8 z-40 flex items-center gap-4">
        {!gateSatisfied && (
          <span className="text-gray-400 text-base">
            Please watch the video before continuing.
          </span>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!gateSatisfied}
          className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
            gateSatisfied
              ? "bg-white text-black hover:bg-gray-200"
              : "bg-gray-700 text-gray-400 cursor-not-allowed"
          }`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
