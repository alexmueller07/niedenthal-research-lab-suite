import { useState } from "react";

// "I need help" for the participant, sitting in the bottom-left corner for the
// whole session.
//
// Pressing it writes a flag into the participant's progress file, which the
// round-robin dashboard picks up on its next refresh — so an RA watching the
// dashboard from the other room sees the request without the participant
// having to get up. Nothing about the study changes; the button is a signal,
// not a control.
//
// Kept small and gray on purpose: it has to be findable without competing with
// the task for attention.

interface HelpButtonProps {
  /** Called when the participant confirms they want help. */
  onRequestHelp: () => void;
  /**
   * Called when the participant takes the request back. Randy, 2026-07-30:
   * "Once the RA is alerted, though, we'll be able to figure out how to turn it
   * off?" — the researcher can always clear it from the dashboard, and now the
   * participant can withdraw it themselves rather than sitting there waiting
   * for help they no longer need.
   */
  onCancelHelp: () => void;
  /** True while a request is outstanding (the researcher has not cleared it). */
  pending: boolean;
}

export default function HelpButton({
  onRequestHelp,
  onCancelHelp,
  pending,
}: HelpButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  // `pending` is the only source of truth for the notice — the parent sets it
  // as soon as the request is sent and clears it once the researcher marks the
  // request handled, so the notice goes away on its own.
  const send = () => {
    onRequestHelp();
    setShowConfirm(false);
  };

  return (
    <>
      <div className="fixed bottom-8 left-8 z-40 cursor-auto">
        {pending ? (
          <div className="flex items-center gap-3 px-4 py-2 border border-gray-500 bg-black">
            <span className="text-gray-300 text-sm">Researcher notified — please wait</span>
            <button
              type="button"
              onClick={onCancelHelp}
              className="text-gray-400 text-sm underline hover:text-white transition-colors"
            >
              I&apos;m okay now
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="px-4 py-2 border border-gray-500 text-gray-400 text-sm bg-black hover:border-white hover:text-white transition-colors"
          >
            Need help?
          </button>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-auto">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4">
            <h2 className="text-white text-xl font-bold mb-4">Ask for help</h2>
            <p className="text-white text-lg mb-6">
              This lets the researcher know you need help. Your place in the study
              is saved — nothing is lost.
            </p>
            <div className="flex space-x-4 justify-between">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-6 py-2 border border-white text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Never mind
              </button>
              <button
                type="button"
                onClick={send}
                className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
              >
                Notify the researcher
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
