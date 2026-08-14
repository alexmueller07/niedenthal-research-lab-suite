import type { RRData, RRParticipant } from "./store";
import { participantProgress } from "./store";

// Shown to a participant right after email check-in. Deliberately shows only
// their own group number and how many partners remain — never other
// participants' emails (IRB 2020-1657: no exposing identifiers to other
// participants).
interface WelcomeProps {
  data: RRData;
  participant: RRParticipant;
  isNew: boolean;
  onContinue: () => void;
}

export default function Welcome({ data, participant, isNew, onContinue }: WelcomeProps) {
  const progress = participantProgress(data, participant.email);

  // min-h-screen + scroll, not a locked viewport, so nothing clips on short
  // laptops (see RatingOverlay.tsx for the original fix).
  return (
    <div className="w-full flex flex-col items-center justify-center bg-black cursor-auto min-h-screen overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto px-8">
        <h1 className="text-white text-4xl font-bold mb-8">
          {isNew ? "You're checked in!" : "Welcome back!"}
        </h1>

        <p className="text-white text-2xl mb-6">
          You are in <span className="font-bold">Group {participant.group}</span>.
        </p>
        {progress.total > 0 ? (
          <p className="text-white text-2xl mb-6">
            You have met {progress.met} of your {progress.total} group partner
            {progress.total === 1 ? "" : "s"} so far.
          </p>
        ) : (
          <p className="text-white text-2xl mb-6">
            Your group partners will be assigned as more participants join.
          </p>
        )}
        <p className="text-white text-lg mb-8">
          Please let the researcher know you have checked in.
        </p>

        <button
          onClick={onContinue}
          className="w-full px-8 py-4 text-white text-xl border border-white bg-black hover:bg-gray-800 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
