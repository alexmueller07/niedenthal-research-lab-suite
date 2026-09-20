// The screen between two conversations.
//
// Randy, 2026-09-19: "when people come in they will always stay at the same
// computer. Theoretically after their convo they will sit back down where they
// were. So maybe it goes back to a screen that says 'log which round it is'.
// Randy is worried because the app records data continuously. Save a CSV after
// every round and then bring them back to the page."
//
// The worry is the right one. A session used to end when the study ended, so
// "the data is written" and "the participant is finished" were the same event.
// With rounds they are not: the participant finishes a conversation's worth of
// work and then sits there while an RA decides what happens next, and anything
// still buffered in memory during that gap is data that a stray Alt+F4 costs.
// So by the time this screen renders, the round's files are closed and its row
// is in the ledger. Nothing on this screen is load-bearing for the data.
//
// It is two screens in one, which is deliberate. The big text is for the
// participant, who should do exactly one thing: fetch their researcher. The
// controls are small, grey, at the bottom, and worded for an RA — a participant
// reading them learns nothing they can act on, and an RA walking over finds
// them where the app's researcher controls always are.

interface RoundCompleteProps {
  /** The round that just finished. */
  round: number;
  /** Where its files were written, shown to the RA as proof. */
  folder: string;
  ratingsFile: string;
  transitionsFile: string;
  /** Set this station up for the participant's next conversation. */
  onNextRound: () => void;
  /** No more rounds: run the wrap-up questionnaires and the sharing page. */
  onFinishSession: () => void;
}

export default function RoundComplete({
  round,
  folder,
  ratingsFile,
  transitionsFile,
  onNextRound,
  onFinishSession,
}: RoundCompleteProps) {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center px-8 cursor-auto">
      <p className="text-gray-400 text-lg uppercase tracking-widest mb-6">
        Round {round} complete
      </p>
      <p className="text-white text-2xl text-center max-w-2xl">
        Please let your researcher know you have finished this part. You can stay
        at this computer.
      </p>

      {/* For the RA, not the participant. */}
      <div className="mt-24 border-t border-gray-800 pt-8 w-full max-w-3xl">
        <p className="text-gray-500 text-xs text-center mb-5">
          Researcher: this round is saved. Choose what happens next.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            type="button"
            onClick={onNextRound}
            className="px-6 py-3 text-white border border-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Log the next round
          </button>
          <button
            type="button"
            onClick={onFinishSession}
            className="px-6 py-3 text-gray-400 border border-gray-600 rounded-lg hover:border-white hover:text-white transition-colors"
          >
            Finish this participant&rsquo;s session
          </button>
        </div>
        <p className="text-gray-600 text-xs text-center mt-4">
          Finishing runs the last few questions and the video-sharing page, which
          are asked once rather than after every conversation.
        </p>

        {/* Proof the round landed somewhere, and where. A round whose files are
            not on the Research Drive is worth catching while everyone is still
            in the room — same reasoning as the old end-of-session screen. */}
        <p className="text-gray-700 text-xs text-center mt-10 font-mono break-all">
          {folder}
          <br />
          {ratingsFile} · {transitionsFile}
        </p>
      </div>
    </div>
  );
}
