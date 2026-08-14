import { useState } from "react";
import { ADMIN_EMAIL, isValidEmail, normalizeEmail } from "./store";

// First screen of the app: email-only check-in (no password). A participant
// email registers/looks up the person and shows their group; the admin email
// opens the researcher dashboard. Styled to match the rest of the app.
interface SignInProps {
  onParticipant: (email: string) => void;
  onAdmin: () => void;
}

export default function SignIn({ onParticipant, onAdmin }: SignInProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleContinue = () => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    if (normalized === ADMIN_EMAIL) {
      onAdmin();
    } else {
      onParticipant(normalized);
    }
  };

  // min-h-screen + scroll, not a locked viewport, so nothing clips on short
  // laptops (see RatingOverlay.tsx for the original fix).
  return (
    <div className="w-full flex flex-col items-center justify-center bg-black cursor-auto min-h-screen overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto px-8">
        <h1 className="text-white text-4xl font-bold mb-8">Study Check-In</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-white text-lg mb-2 text-left">
              Please enter your email:
            </label>
            <input
              autoComplete="off"
              autoFocus
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              placeholder="you@wisc.edu"
              className="w-full p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
            />
            {error && <p className="text-red-400 text-sm mt-2 text-left">{error}</p>}
          </div>

          <button
            onClick={handleContinue}
            className="w-full px-8 py-4 text-white text-xl border border-white bg-black hover:bg-gray-800 transition-colors mt-6"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
