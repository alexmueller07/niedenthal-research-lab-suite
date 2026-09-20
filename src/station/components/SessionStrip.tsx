// Who this computer thinks you are, and which round this is.
//
// Randy, 2026-09-19: "in the app itself it would be helpful if we had left
// right of course but also specify what color it is (maybe on the bottom
// specify green talking to orange or something like that), and for every round
// R1, R2, R3."
//
// It is a check, not an instruction. An RA who taps the wrong nametag colour at
// setup produces a session whose data is attributed to the wrong person, and
// nothing later in the app would ever mention it — the participant answers
// questions about "your partner" and the files say whatever the RA typed. A
// line at the bottom of the screen saying "Green (Left) · talking to Orange
// (Right) · Round 2" is read by the participant wearing the green nametag, and
// by the RA walking past, and either of them can catch it in a second.
//
// Deliberately small and grey: it must be legible on purpose and invisible by
// accident. It is never on screen during the continuous rating — the pointer is
// the measurement there, and anything at the bottom of the screen invites the
// cursor down to it (same rule as HelpButton; see App.tsx `cursorLocked`).

import { colorHex, colorLabel } from "../roundrobin/sessionBoard";

interface SessionStripProps {
  participantColor: string;
  partnerColor: string;
  /** "Left" | "Right", as the setup screen records it. */
  seat: string;
  round: number;
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block w-3 h-3 rounded-full border border-white/50 align-middle"
      style={{ backgroundColor: colorHex(color) }}
    />
  );
}

export default function SessionStrip({
  participantColor,
  partnerColor,
  seat,
  round,
}: SessionStripProps) {
  // With no colours assigned (an RA typed the IDs by hand) there is nothing
  // worth saying — the round on its own is not a check anyone can act on.
  if (!participantColor && !partnerColor) return null;

  const otherSeat = seat === "Left" ? "Right" : seat === "Right" ? "Left" : "";

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 pointer-events-none flex justify-center pb-1.5">
      {/* Its own black pill rather than a transparent line: it sits over
          whatever the screen below it happens to draw at the bottom, and grey
          text on top of white text is unreadable in a way neither of them
          deserves. */}
      <p className="bg-black px-3 py-0.5 rounded text-gray-500 text-xs tracking-wide flex items-center gap-2">
        {participantColor && (
          <>
            <Swatch color={participantColor} />
            <span>
              {colorLabel(participantColor)}
              {seat ? ` (${seat})` : ""}
            </span>
          </>
        )}
        {participantColor && partnerColor && <span>talking to</span>}
        {partnerColor && (
          <>
            <Swatch color={partnerColor} />
            <span>
              {colorLabel(partnerColor)}
              {otherSeat ? ` (${otherSeat})` : ""}
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>Round R{round}</span>
      </p>
    </div>
  );
}
