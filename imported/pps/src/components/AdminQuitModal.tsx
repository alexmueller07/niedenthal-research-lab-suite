import { useEffect, useRef, useState } from "react";

interface AdminQuitModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// The exact word the researcher must type to confirm a save-and-quit.
const CONFIRM_WORD = "Confirm";

// Researcher-only "save and quit" gate. Opened by the Ctrl+Shift+Q shortcut
// (handled in App). The participant is not told this shortcut exists; requiring
// the typed confirmation word also prevents an accidental key combination from
// quitting the session.
export default function AdminQuitModal({ isOpen, onCancel, onConfirm }: AdminQuitModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field and focus the input each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setValue("");
      // Focus after the modal paints.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const canConfirm = value.trim() === CONFIRM_WORD;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
        <h2 className="text-white text-xl font-bold mb-4">Researcher: Save &amp; Quit</h2>
        <p className="text-white text-lg mb-4">
          Type <strong>&ldquo;{CONFIRM_WORD}&rdquo;</strong> to save all data collected so far and
          quit the application.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          // Stop propagation so keystrokes here never reach the task-level
          // window keydown handlers running in the background.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && canConfirm) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-4 py-2 mb-6 rounded-lg bg-gray-900 text-white border border-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={CONFIRM_WORD}
        />
        <div className="flex space-x-4 justify-between">
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-white text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-6 py-2 bg-white text-black rounded-lg font-semibold transition-colors enabled:hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save &amp; Quit
          </button>
        </div>
      </div>
    </div>
  );
}
