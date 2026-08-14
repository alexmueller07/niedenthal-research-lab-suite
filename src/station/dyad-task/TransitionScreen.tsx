import { useEffect, useState } from "react";
import PressKeyPrompt from "../components/PressKeyPrompt";

// The screen that announces whose feelings the next block is about.
//
// Randy, 2026-07-30: participants were missing the perspective switch, and a
// participant who is bored of the study will press through an announcement
// screen without reading it. So this screen holds itself open: keys do nothing
// for the first few seconds, and the remaining time is shown so the wait reads
// as deliberate rather than as a frozen app.
//
// The dwell is a data-quality control, not decoration — a block rated from the
// wrong perspective is unusable, and there is no way to detect it after the
// fact.

/** How long the announcement stays up before any key will advance it. */
const MIN_DWELL_MS = 6000;

interface TransitionScreenProps {
  ratingTarget: "self" | "partner";
  onContinue: () => void;
}

function TransitionScreen({ ratingTarget, onContinue }: TransitionScreenProps) {
  const [remainingMs, setRemainingMs] = useState(MIN_DWELL_MS);
  const locked = remainingMs > 0;

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, MIN_DWELL_MS - (Date.now() - startedAt)));
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (locked) return;
    const handler = () => onContinue();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [locked, onContinue]);

  const perspective = ratingTarget === "self" ? "YOUR OWN FEELINGS" : "YOUR PARTNER'S FEELINGS";

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black z-20">
      <div className="bg-black border p-12 max-w-3xl mx-auto text-center">
        <p className="text-gray-400 text-lg uppercase tracking-widest mb-8">
          For this next part of the video
        </p>

        <h1 className="text-white text-3xl leading-relaxed">
          You will be rating{" "}
          <span className="font-bold border-b-4 border-white pb-1">{perspective}</span>{" "}
          during the conversation.
        </h1>

        <p className="text-gray-300 text-xl mt-10">
          {ratingTarget === "self"
            ? "Think about how YOU were feeling, moment to moment."
            : "Think about how YOUR PARTNER was feeling, moment to moment."}
        </p>

        {locked ? (
          <div className="mt-32 p-4 bg-gray-800 rounded-lg border border-gray-600">
            <p className="text-gray-400 text-2xl text-center">
              Please read the above. Continuing in {Math.ceil(remainingMs / 1000)}…
            </p>
          </div>
        ) : (
          <PressKeyPrompt />
        )}
      </div>
    </div>
  );
}

export default TransitionScreen;
