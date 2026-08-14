// RETIRED (2026-07-23), pending Randy — see the note at the top of ../scenarios.ts.
// The video affective-response task in src/video-task occupies this slot now.

import { useState, useEffect, useMemo, useCallback } from "react";
import ConfirmationModal from "../../components/ConfirmationModal";
import type { Scenario } from "../scenarios";
import { shuffle } from "../../utils/shuffle";

export interface EmotionRating {
  emotion: string;
  // "" when the participant skipped the rating (skipping is allowed in a study).
  intensity: number | "";
  confidence: number | "";
}

interface ScenarioRatingProps {
  scenarios: Scenario[];
  // Grammatical phrase for the rated target, e.g. "you", "your partner",
  // "an average UW-Madison student". Used in the emotion prompt.
  targetPhrase: string;
  // Called once per scenario with all emotion ratings for that scenario.
  onScenarioComplete: (scenarioId: string, ratings: EmotionRating[]) => void;
  // Called after the last scenario for this target is submitted.
  onAllScenariosComplete: () => void;
}

const SCALE_POINTS = [1, 2, 3, 4, 5, 6, 7];

// A 1-7 rating row: small circular "bubbles" with the number centered inside,
// and the "Not at all" / "Extremely" anchors placed below the endpoints
// (outside the bubbles).
function ScaleSelect({
  value,
  onSelect,
}: {
  value: number | undefined;
  onSelect: (v: number) => void;
}) {
  return (
    <div className="inline-flex flex-col items-stretch">
      <div className="flex items-center justify-center gap-3">
        {SCALE_POINTS.map((point) => (
          <button
            key={point}
            type="button"
            onClick={() => onSelect(point)}
            className={`flex items-center justify-center w-9 h-9 rounded-full border text-sm font-semibold leading-none transition-colors ${
              value === point
                ? "bg-white text-black border-white"
                : "bg-black text-white border-gray-500 hover:border-white"
            }`}
          >
            {point}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-white text-sm">Not at all</span>
        <span className="text-white text-sm">Extremely</span>
      </div>
    </div>
  );
}

export default function ScenarioRating({
  scenarios,
  targetPhrase,
  onScenarioComplete,
  onAllScenariosComplete,
}: ScenarioRatingProps) {
  // Randomize scenario order once per mount (mount is keyed per target upstream).
  const [orderedScenarios] = useState<Scenario[]>(() => shuffle(scenarios));
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showIncompleteConfirm, setShowIncompleteConfirm] = useState(false);

  const current = orderedScenarios[scenarioIndex];

  // Randomize the emotion order for the current scenario.
  const orderedEmotions = useMemo(() => shuffle(current.emotions), [current]);

  // intensity[emotion] and confidence[emotion] for the current scenario.
  const [intensity, setIntensity] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});

  // Reset answers whenever the scenario changes.
  useEffect(() => {
    setIntensity({});
    setConfidence({});
    setShowIncompleteConfirm(false);
  }, [scenarioIndex]);

  const isComplete = orderedEmotions.every(
    (e) => intensity[e] !== undefined && confidence[e] !== undefined
  );

  // Records the scenario (blank for any skipped rating) and advances.
  const doSubmit = useCallback(() => {
    const ratings: EmotionRating[] = orderedEmotions.map((e) => ({
      emotion: e,
      intensity: intensity[e] ?? "",
      confidence: confidence[e] ?? "",
    }));
    onScenarioComplete(current.id, ratings);
    setShowIncompleteConfirm(false);

    if (scenarioIndex + 1 >= orderedScenarios.length) {
      onAllScenariosComplete();
    } else {
      setScenarioIndex((i) => i + 1);
    }
  }, [
    orderedEmotions,
    intensity,
    confidence,
    current,
    scenarioIndex,
    orderedScenarios.length,
    onScenarioComplete,
    onAllScenariosComplete,
  ]);

  // Next button: warn (but never force) when something was left blank.
  const handleNext = () => {
    if (isComplete) doSubmit();
    else setShowIncompleteConfirm(true);
  };

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      {/* Instruction header — pinned to the top while the page scrolls. */}
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          In this part of the survey, you will read a series of situations.
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 py-8 max-w-3xl w-full mx-auto">
        <div className="text-center mb-10">
          <p className="text-white text-2xl leading-relaxed">{current.text}</p>
        </div>

        <div className="flex flex-col items-center gap-6 w-full">
          {orderedEmotions.map((emotion) => (
            <div key={emotion} className="flex flex-col items-center gap-2">
              <p className="text-white text-2xl text-center">
                Rate the degree to which {targetPhrase} would feel <strong>{emotion}</strong>.
              </p>
              <ScaleSelect
                value={intensity[emotion]}
                onSelect={(v) => setIntensity((p) => ({ ...p, [emotion]: v }))}
              />

              <p className="text-white text-lg text-center mt-1">How confident are you about your rating?</p>
              <ScaleSelect
                value={confidence[emotion]}
                onSelect={(v) => setConfidence((p) => ({ ...p, [emotion]: v }))}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Next — frozen in the bottom-right corner. */}
      <div className="fixed bottom-8 right-8 z-40">
        <button
          type="button"
          onClick={handleNext}
          className="px-8 py-3 rounded-lg font-semibold transition-colors bg-white text-black hover:bg-gray-200"
        >
          Next
        </button>
      </div>

      <ConfirmationModal
        isOpen={showIncompleteConfirm}
        onClose={() => setShowIncompleteConfirm(false)}
        onConfirm={doSubmit}
        message="Hey, you didn't answer every question on this screen. Are you sure you want to continue?"
        confirmText="Continue anyway"
        cancelText="Go back"
      />
    </div>
  );
}
