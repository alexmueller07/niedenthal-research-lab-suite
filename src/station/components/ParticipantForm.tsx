import { useState } from "react";
import type { FormData } from "../App";

// Visuals match Suhaas's original form exactly (text-4xl heading, text-lg
// labels, p-3 inputs, full-width bordered Start button). Our filename-safety
// validation for ID fields is kept — error text only appears after a failed
// submit, so the untouched form is pixel-identical to the original.
interface ParticipantFormProps {
  formData: FormData;
  onChange: (field: string, value: string) => void;
  onSubmit: () => void;
}

// IDs must be alphanumeric with optional underscores/dashes — no path-special chars.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateId(value: string): string | null {
  if (!value.trim()) return "Required";
  if (!ID_PATTERN.test(value))
    return 'Only letters, numbers, underscores, and dashes allowed (no spaces or / \\ : * ? " < > |)';
  return null;
}

function ParticipantForm({ formData, onChange, onSubmit }: ParticipantFormProps) {
  const [idErrors, setIdErrors] = useState<{ [key: string]: string | null }>({});
  const [attempted, setAttempted] = useState(false);

  const idFields = ["dyadId", "participantId", "partnerId", "subjectInitials"] as const;

  const validate = () => {
    const errors: { [key: string]: string | null } = {};
    for (const f of idFields) {
      errors[f] = validateId(formData[f]);
    }
    setIdErrors(errors);
    return Object.values(errors).every((e) => e === null);
  };

  const allRequiredFilled =
    formData.dyadId &&
    formData.participantId &&
    formData.partnerId &&
    formData.computer &&
    formData.subjectInitials &&
    formData.saveFolder &&
    formData.raName &&
    formData.sessionTime &&
    formData.sessionDate;

  const handleSubmit = () => {
    setAttempted(true);
    if (!allRequiredFilled) {
      alert("Please fill in all fields.");
      return;
    }
    if (!validate()) return;
    onSubmit();
  };

  const handleIdChange = (field: string, value: string) => {
    onChange(field, value);
    if (attempted) {
      setIdErrors((prev) => ({ ...prev, [field]: validateId(value) }));
    }
  };

  const inputClass =
    "w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400";
  const errorClass = "text-red-400 text-xs mt-1 text-left";

  // min-h-screen + scroll, not a locked viewport: on a short laptop this form
  // ran past the window with no scroll path, hiding the bottom fields and the
  // Start button (same clipping RatingOverlay had — see RatingOverlay.tsx).
  return (
    <div className="w-full flex flex-col items-center justify-center bg-black cursor-auto min-h-screen overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto px-8">
        <h1 className="text-white text-4xl font-bold mb-8">
          Please Enter the Participant's Information
        </h1>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white text-lg mb-2">Dyad ID:</label>
              <input
                autoComplete="off"
                type="text"
                value={formData.dyadId}
                onChange={(e) => handleIdChange("dyadId", e.target.value)}
                className={inputClass}
              />
              {idErrors.dyadId && <p className={errorClass}>{idErrors.dyadId}</p>}
            </div>

            <div>
              <label className="block text-white text-lg mb-2">
                Participant ID:
              </label>
              <input
                autoComplete="off"
                type="text"
                value={formData.participantId}
                onChange={(e) => handleIdChange("participantId", e.target.value)}
                className={inputClass}
              />
              {idErrors.participantId && <p className={errorClass}>{idErrors.participantId}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white text-lg mb-2">
                Partner ID:
              </label>
              <input
                autoComplete="off"
                type="text"
                value={formData.partnerId}
                onChange={(e) => handleIdChange("partnerId", e.target.value)}
                className={inputClass}
              />
              {idErrors.partnerId && <p className={errorClass}>{idErrors.partnerId}</p>}
            </div>

            <div>
              <label className="block text-white text-lg mb-2">
                Subject Initials:
              </label>
              <input
                autoComplete="off"
                type="text"
                value={formData.subjectInitials}
                onChange={(e) => handleIdChange("subjectInitials", e.target.value)}
                className={inputClass}
              />
              {idErrors.subjectInitials && <p className={errorClass}>{idErrors.subjectInitials}</p>}
            </div>
          </div>

          <div>
            <label className="block text-white text-lg mb-2">
              Computer (L/R):
            </label>
            <div className="flex space-x-4">
              <button
                type="button"
                onClick={() => onChange("computer", "Left")}
                className={`flex-1 px-4 py-3 border border-white rounded-lg transition-colors ${
                  formData.computer === "Left"
                    ? "bg-white text-black"
                    : "bg-gray-800 hover:bg-gray-700 text-white"
                }`}
              >
                Left
              </button>
              <button
                type="button"
                onClick={() => onChange("computer", "Right")}
                className={`flex-1 px-4 py-3 border border-white rounded-lg transition-colors ${
                  formData.computer === "Right"
                    ? "bg-white text-black"
                    : "bg-gray-800 hover:bg-gray-700 text-white"
                }`}
              >
                Right
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white text-lg mb-2">RA Name:</label>
              <input
                autoComplete="off"
                type="text"
                value={formData.raName}
                onChange={(e) => onChange("raName", e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-white text-lg mb-2">
                Session Time:
              </label>
              <input
                autoComplete="off"
                type="text"
                value={formData.sessionTime}
                onChange={(e) => onChange("sessionTime", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-white text-lg mb-2">
              Session Date:
            </label>
            <input
              autoComplete="off"
              type="text"
              value={formData.sessionDate}
              onChange={(e) => onChange("sessionDate", e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-white text-lg mb-2">
              Save Folder:
            </label>
            <div className="flex space-x-2">
              <input
                autoComplete="off"
                type="text"
                value={formData.saveFolder}
                onChange={(e) => onChange("saveFolder", e.target.value)}
                placeholder="Select folder to save ratings..."
                className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
                readOnly
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const selected = await open({
                      directory: true,
                      title: "Select folder to save ratings",
                    });
                    if (selected) {
                      onChange("saveFolder", selected as string);
                    }
                  } catch (error) {
                    console.error("Error selecting folder:", error);
                  }
                }}
                className="px-4 py-3 text-white border border-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            className="w-full px-8 py-4 text-white text-xl border border-white bg-black hover:bg-gray-800 transition-colors mt-6"
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  );
}

export default ParticipantForm;
