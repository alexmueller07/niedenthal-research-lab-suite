import { useEffect, useState } from "react";
import MatrixSlider from "../components/MatrixSlider";
import ConfirmationModal from "../components/ConfirmationModal";
import StimulusPlayer from "./StimulusPlayer";
import { shuffle } from "../utils/shuffle";

// The "combined" rating page: one pass through the clips, and every emotion is
// rated for all three perspectives at once.
//
// Randy, 2026-07-30: "maybe one way to save time would be to make all three
// ratings for each emotion at the same time (You, Average-UW Student, Your
// Partner)". This is that page. It is off by default — see VideoRatingMode in
// utils/settings.ts for why, and for how to switch it on.
//
// The page is grouped by emotion rather than by person on purpose: the whole
// point of combining is that the three judgments about one feeling sit next to
// each other. Grouping by person instead would just be the separate task with
// more scrolling.
//
// Rows are written in exactly the same shape as the separate mode
// (video_affect / clip / emotion / measure / person / value), so nothing
// downstream has to know which mode a session ran in.

export interface CombinedRating {
  emotion: string;
  person: string;
  intensity: number | "";
  confidence: number | "";
}

interface CombinedRatingPageProps {
  videoId: string;
  emotions: string[];
  /** The three perspectives, in the order they should be shown. */
  people: string[];
  src: string;
  positionLabel: string;
  onSubmit: (ratings: CombinedRating[], replays: number) => void;
}

/** Row label for a perspective. Uppercase because the group asked for it. */
function personRow(person: string): string {
  if (person === "yourself") return "YOU";
  if (person === "your partner") return "YOUR PARTNER";
  return "THE AVERAGE UW–MADISON STUDENT";
}

export default function CombinedRatingPage({
  videoId,
  emotions,
  people,
  src,
  positionLabel,
  onSubmit,
}: CombinedRatingPageProps) {
  const [ordered, setOrdered] = useState<string[]>(() => shuffle(emotions));
  // Keyed "<emotion>|<person>" so one flat record covers the whole page.
  const [intensity, setIntensity] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    setOrdered(shuffle(emotions));
    setIntensity({});
    setConfidence({});
    setShowIncomplete(false);
    setShowReplay(false);
    setReplays(0);
  }, [videoId, emotions]);

  const key = (emotion: string, person: string) => `${emotion}|${person}`;

  const cells = ordered.flatMap((e) => people.map((p) => key(e, p)));
  const complete = cells.every(
    (k) => intensity[k] !== undefined && confidence[k] !== undefined
  );

  const submit = () => {
    setShowIncomplete(false);
    onSubmit(
      ordered.flatMap((emotion) =>
        people.map((person) => ({
          emotion,
          person,
          intensity: intensity[key(emotion, person)] ?? "",
          confidence: confidence[key(emotion, person)] ?? "",
        }))
      ),
      replays
    );
  };

  const rows = people.map(personRow);
  /** MatrixSlider works in row labels, so translate back on the way out. */
  const personForRow = (rowIndex: number) => people[rowIndex];
  const selectionsFor = (
    store: Record<string, number>,
    emotion: string
  ): Record<string, number> =>
    Object.fromEntries(
      people
        .map((person, index) => [rows[index], store[key(emotion, person)]] as const)
        .filter(([, value]) => value !== undefined)
    );

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="sticky top-0 z-40 w-full bg-black border-b border-white px-8 py-4">
        <h2 className="text-white text-2xl font-bold text-center">
          For each feeling, rate how strongly the video evokes it for each person,
          and how confident you are in your answer. (1 = Not at all, 100 = Extremely)
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center px-8 pt-10 pb-4 w-10/12 mx-auto">
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-gray-400 text-base">{positionLabel}</span>
          <button
            type="button"
            onClick={() => setShowReplay(true)}
            className="px-4 py-2 text-white text-base border border-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Replay video
          </button>
        </div>

        <div className="w-full space-y-10">
          {ordered.map((emotion) => (
            <div key={emotion} className="border-t border-gray-700 pt-6 first:border-t-0 first:pt-0">
              <p className="text-white text-2xl font-bold mb-4 uppercase tracking-wide">
                {emotion}
              </p>

              <p className="text-white text-xl mb-2">
                How strongly does this video make each of the following feel{" "}
                <span className="font-bold">{emotion}</span>?
              </p>
              <MatrixSlider
                leftLabel="Not at all"
                rightLabel="Extremely"
                min={1}
                max={100}
                defaultSelection={50}
                rows={rows}
                selections={selectionsFor(intensity, emotion)}
                onSelectionChange={(rowIndex, value) =>
                  setIntensity((prev) => ({
                    ...prev,
                    [key(emotion, personForRow(rowIndex))]: value,
                  }))
                }
              />

              <p className="text-white text-xl mt-5 mb-2">
                How confident are you in each of the three ratings above?
              </p>
              <MatrixSlider
                leftLabel="Not at all confident"
                rightLabel="Extremely confident"
                min={1}
                max={100}
                defaultSelection={50}
                rows={rows}
                selections={selectionsFor(confidence, emotion)}
                onSelectionChange={(rowIndex, value) =>
                  setConfidence((prev) => ({
                    ...prev,
                    [key(emotion, personForRow(rowIndex))]: value,
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-8 right-8 z-40">
        <button
          type="button"
          onClick={() => (complete ? submit() : setShowIncomplete(true))}
          className="px-8 py-3 rounded-lg font-semibold transition-colors bg-white text-black hover:bg-gray-200"
        >
          Continue
        </button>
      </div>

      {showReplay && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-8">
          <div className="bg-black border border-white p-6 max-w-5xl w-full">
            <StimulusPlayer src={src} compact onWatched={() => setReplays((n) => n + 1)} />
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
