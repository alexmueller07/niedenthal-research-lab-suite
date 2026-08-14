import { useEffect, useState } from "react";
import MatrixSlider from "../components/MatrixSlider";
import ConfirmationModal from "../components/ConfirmationModal";
import StimulusPlayer from "./StimulusPlayer";
import { shuffle } from "../utils/shuffle";

// Page 2 of each trial: the six questions. Three emotions × (how strongly the
// clip evokes it, how confident the participant is in that rating), all on one
// page, on 1-100 sliders.
//
// Emotion order is shuffled once per trial and shared by both blocks, so a
// participant reads the same three emotions in the same order twice — the
// confidence block is meant to mirror the intensity block, not re-order it.

export interface VideoRating {
  emotion: string;
  /** "" when the participant left the slider untouched (skipping is allowed). */
  intensity: number | "";
  confidence: number | "";
}

interface VideoRatingPageProps {
  videoId: string;
  emotions: string[];
  src: string;
  /** Grammatical phrase for the rated target: "you", "your partner", … */
  targetPhrase: string;
  /** The same target in caps, for the banner: "YOUR PARTNER". */
  targetCaps: string;
  /** True for the self block — changes tense ("did this video make you feel"). */
  isSelf: boolean;
  positionLabel: string;
  onSubmit: (ratings: VideoRating[], replays: number) => void;
}

export default function VideoRatingPage({
  videoId,
  emotions,
  src,
  targetPhrase,
  targetCaps,
  isSelf,
  positionLabel,
  onSubmit,
}: VideoRatingPageProps) {
  const [ordered, setOrdered] = useState<string[]>(() => shuffle(emotions));
  const [intensity, setIntensity] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [replays, setReplays] = useState(0);

  // Guard against the page being reused across trials without a remount.
  useEffect(() => {
    setOrdered(shuffle(emotions));
    setIntensity({});
    setConfidence({});
    setShowIncomplete(false);
    setShowReplay(false);
    setReplays(0);
  }, [videoId, emotions]);

  const complete = ordered.every(
    (e) => intensity[e] !== undefined && confidence[e] !== undefined
  );

  const submit = () => {
    setShowIncomplete(false);
    onSubmit(
      ordered.map((e) => ({
        emotion: e,
        intensity: intensity[e] ?? "",
        confidence: confidence[e] ?? "",
      })),
      replays
    );
  };

  const handleContinue = () => {
    if (complete) submit();
    else setShowIncomplete(true);
  };

  const intensityPrompt = isSelf
    ? "How strongly did this video make YOU feel each of the following?"
    : `How strongly do you think this video would make ${targetPhrase.toUpperCase()} feel each of the following?`;

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          For each video clip, rate how strongly it evokes each feeling, and how
          confident you are in your answer. (1 = Not at all, 100 = Extremely)
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-16 pb-4 w-10/12 mx-auto">
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-gray-400 text-base">{positionLabel}</span>
          <span className="border border-white px-4 py-1.5 text-white text-base">
            You are rating: <span className="font-bold">{targetCaps}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowReplay(true)}
            className="px-4 py-2 text-white text-base border border-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Replay video
          </button>
        </div>

        <div className="w-full space-y-5">
          <div>
            <p className="text-white text-xl mb-2">{intensityPrompt}</p>
            <MatrixSlider
              leftLabel="Not at all"
              rightLabel="Extremely"
              min={1}
              max={100}
              defaultSelection={50}
              rows={ordered}
              selections={intensity}
              onSelectionChange={(rowIndex, value) =>
                setIntensity((prev) => ({ ...prev, [ordered[rowIndex]]: value }))
              }
            />
          </div>

          <div>
            <p className="text-white text-xl mb-2">
              How confident are you in each of your answers above?
            </p>
            <MatrixSlider
              leftLabel="Not at all confident"
              rightLabel="Extremely confident"
              min={1}
              max={100}
              defaultSelection={50}
              rows={ordered}
              selections={confidence}
              onSelectionChange={(rowIndex, value) =>
                setConfidence((prev) => ({ ...prev, [ordered[rowIndex]]: value }))
              }
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-8 right-8 z-40">
        <button
          type="button"
          onClick={handleContinue}
          className="px-8 py-3 rounded-lg font-semibold transition-colors bg-white text-black hover:bg-gray-200"
        >
          Continue
        </button>
      </div>

      {showReplay && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-8">
          <div className="bg-black border border-white p-6 max-w-5xl w-full">
            <StimulusPlayer
              src={src}
              compact
              onWatched={() => setReplays((n) => n + 1)}
            />
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowReplay(false)}
                className="px-6 py-2 text-white border border-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Back to the ratings
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={showIncomplete}
        onClose={() => setShowIncomplete(false)}
        onConfirm={submit}
      />
    </div>
  );
}
