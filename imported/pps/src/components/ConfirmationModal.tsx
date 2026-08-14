// One wording for "you left something blank", used everywhere.
//
// Randy, 2026-07-30: the video task's version ("Hey, you didn't answer every
// question on this screen…") read as too informal next to the questionnaires'.
// Rather than fix that one string, the formal wording is the component's default
// so a new page gets it without anyone having to remember.
export const INCOMPLETE_MESSAGE =
  "There are unanswered questions on this page. Would you like to continue?";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message = INCOMPLETE_MESSAGE,
  confirmText = "Continue",
  cancelText = "Go back",
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  // bg-black/50, not bg-opacity-50: the bg-opacity-* utilities were removed in
  // Tailwind v4, so the old class silently rendered the backdrop fully opaque.
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4">
        {title && (
          <h2 className="text-white text-xl font-bold mb-4">{title}</h2>
        )}
        <p className="text-white text-lg mb-6">{message}</p>
        <div className="flex space-x-4 justify-between">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-white text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
