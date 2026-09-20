import { useEffect, useRef, useState } from "react";
import NumberScale from "../components/NumberScale";
import ConfirmationModal from "../components/ConfirmationModal";
import ScrollHint from "../components/ScrollHint";
import StimulusPlayer from "./StimulusPlayer";
import { useScrollToTop } from "../utils/scroll";

// The rating page: the clip, then one question per emotion on a 1-7 scale.
//
// Rebuilt to Randy's 2026-08-05 specification, which changed three things at
// once:
//
//   - the scale is 1 (Not at all) … 7 (Extremely), the same shape as the lab's
//     paper questionnaires, instead of a 1-100 slider;
//   - the question names the emotion in the sentence ("To what extent did you
//     feel surprise while watching this video?") rather than listing emotions
//     down the side of a matrix;
//   - confidence is asked once, about the partner ratings as a whole, instead
//     of once per emotion. It is not asked at all about a participant's own
//     feelings — being unsure how *you* felt is a different question, and the
//     empathic-accuracy score does not use it.
//
// The clip sits on the page rather than behind a "replay" button, and at the
// same size on both perspectives ("video and text all same size"): the two
// pages are the same measurement asked about two people, so anything that
// makes one easier to answer than the other is a confound.
//
// THE FOURTH QUESTION — Ben, 2026-09-19. The partner page asks four things
// (three emotions plus confidence) and the fourth sits below the fold on the
// lab's monitors: "not everyone scrolled down every time and didn't see the
// last question". Two answers, because either alone leaks:
//
//   - answering the last emotion scrolls the confidence question into view. A
//     participant who is working down the page is carried to the end of it.
//   - a scroll indicator (ScrollHint), for anyone who answers out of order or
//     whose window is short enough that even the third question is below the
//     fold.
//
// Neither auto-advances or auto-answers anything. Being carried to a question
// is not the same as being asked to give a particular answer to it.

export interface VideoRating {
  emotion: string;
  /** "" when the participant left the question blank (skipping is allowed). */
  intensity: number | "";
}

export interface VideoRatingResult {
  ratings: VideoRating[];
  /** Only collected on the partner page. "" when skipped. */
  confidence: number | "";
  /** How many times the clip was replayed on this page. */
  replays: number;
}

export const SCALE_MIN = 1;
export const SCALE_MAX = 7;

interface VideoRatingPageProps {
  videoId: string;
  /** The three emotions, already in the order this trial should show them. */
  emotions: string[];
  src: string;
  /** Whose feelings this page is about. */
  target: "self" | "partner";
  positionLabel: string;
  onSubmit: (result: VideoRatingResult) => void;
}

export default function VideoRatingPage({
  videoId,
  emotions,
  src,
  target,
  positionLabel,
  onSubmit,
}: VideoRatingPageProps) {
  useScrollToTop();
  const [intensity, setIntensity] = useState<Record<string, number>>({});
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [replays, setReplays] = useState(0);
  const confidenceRef = useRef<HTMLDivElement>(null);

  const self = target === "self";

  // Guard against the page being reused across trials without a remount.
  useEffect(() => {
    setIntensity({});
    setConfidence(undefined);
    setShowIncomplete(false);
    setAttempted(false);
    setReplays(0);
  }, [videoId, target]);

  // Every emotion answered, confidence still blank: bring the confidence
  // question to them. Only on the partner page — the self page has no fourth
  // question — and only while it is genuinely unanswered, so re-editing an
  // emotion afterwards does not yank the page around.
  const allEmotionsAnswered = emotions.every((e) => intensity[e] !== undefined);
  useEffect(() => {
    if (self || !allEmotionsAnswered || confidence !== undefined) return;
    confidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [self, allEmotionsAnswered, confidence]);

  const complete = allEmotionsAnswered && (self || confidence !== undefined);

  const submit = () => {
    setShowIncomplete(false);
    onSubmit({
      ratings: emotions.map((e) => ({ emotion: e, intensity: intensity[e] ?? "" })),
      confidence: self ? "" : (confidence ?? ""),
      replays,
    });
  };

  const handleContinue = () => {
    if (complete) {
      submit();
      return;
    }
    setAttempted(true);
    setShowIncomplete(true);
  };

  const question = (emotion: string) =>
    self
      ? `To what extent did you feel ${emotion} while watching this video?`
      : `To what extent would your partner feel ${emotion} while watching this video?`;

  const CONFIDENCE_QUESTION = "How confident are you in your ratings of your partner?";

  const missing = [
    ...emotions.filter((e) => intensity[e] === undefined).map(question),
    ...(!self && confidence === undefined ? [CONFIDENCE_QUESTION] : []),
  ];

  return (
    <div className="min-h-full w-full flex flex-col bg-black pb-24">
      <div className="flex-1 flex flex-col items-center px-8 pt-8 pb-4 w-full max-w-4xl mx-auto">
        <div className="w-full flex items-center justify-between mb-3">
          <span className="text-gray-500 text-sm">{positionLabel}</span>
          <span className="text-gray-400 text-sm">
            Rating: <span className="text-white font-bold">{self ? "YOU" : "YOUR PARTNER"}</span>
          </span>
        </div>

        {/* Same player, same size, on both perspectives. */}
        <div className="w-full max-w-2xl">
          <StimulusPlayer src={src} compact onWatched={() => setReplays((n) => n + 1)} />
        </div>

        <div className="w-full mt-6">
          {emotions.map((emotion) => (
            <NumberScale
              key={emotion}
              label={question(emotion)}
              min={SCALE_MIN}
              max={SCALE_MAX}
              leftLabel="Not at all"
              rightLabel="Extremely"
              value={intensity[emotion]}
              unanswered={attempted && intensity[emotion] === undefined}
              onChange={(value) =>
                setIntensity((prev) => ({ ...prev, [emotion]: value }))
              }
            />
          ))}

          {/* Asked once, about the partner ratings as a whole. */}
          {!self && (
            <div ref={confidenceRef}>
              <NumberScale
                label={CONFIDENCE_QUESTION}
                min={SCALE_MIN}
                max={SCALE_MAX}
                leftLabel="Not at all"
                rightLabel="Extremely"
                value={confidence}
                unanswered={attempted && confidence === undefined}
                onChange={setConfidence}
              />
            </div>
          )}
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

      <ScrollHint bottomClass="bottom-24" />

      <ConfirmationModal
        isOpen={showIncomplete}
        onClose={() => setShowIncomplete(false)}
        onConfirm={submit}
        missing={missing}
      />
    </div>
  );
}
