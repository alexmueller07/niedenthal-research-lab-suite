import { useState } from "react";
import StimulusPlayer from "./StimulusPlayer";
import type { WatchStats } from "./StimulusPlayer";
import { useScrollToTop } from "../utils/scroll";

// Page 1 of each trial: watch the clip.
//
// Nothing to answer here. Continue is disabled until the clip has run to the
// end once.
//
// Simplified 2026-08-22 with the rest of Randy's restructure. Each clip is now
// watched once and then rated for both perspectives in a row, so the "you have
// seen this before" and "must you watch it again" cases the old three-pass
// design needed have no situations left to describe. The clip is still on the
// rating pages themselves, so a participant who wants another look has one.
//
// Layout notes from the 2026-07-29 review, still true:
//   - the clip is large. It used to occupy about the middle third of the screen
//     while the rating page ran nearly the full width (Ben).
//   - a margin under the pinned header, because the instruction sat outside
//     where people were looking (Ben).

interface VideoWatchPageProps {
  src: string;
  /** e.g. "Video 3 of 8". */
  positionLabel: string;
  onWatched: (stats: WatchStats) => void;
  onContinue: () => void;
}

export default function VideoWatchPage({
  src,
  positionLabel,
  onWatched,
  onContinue,
}: VideoWatchPageProps) {
  useScrollToTop();
  const [watched, setWatched] = useState(false);

  const handleWatched = (stats: WatchStats) => {
    setWatched(true);
    onWatched(stats);
  };

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          Please watch the following video all the way through.
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-24 pb-8 w-11/12 max-w-6xl mx-auto">
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-gray-400 text-base">{positionLabel}</span>
        </div>

        <StimulusPlayer src={src} onWatched={handleWatched} />
      </div>

      <div className="fixed bottom-8 right-8 z-40 flex items-center gap-4">
        {!watched && (
          <span className="text-gray-400 text-base">
            Please watch the video before continuing.
          </span>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!watched}
          className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
            watched
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
