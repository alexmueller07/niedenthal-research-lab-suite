import { useCallback, useEffect, useRef, useState } from "react";
import {
  NAMETAG_COLORS,
  colorHex,
  colorLabel,
  colorsTakenOn,
  dyadsOn,
  emptyBoard,
  loadBoard,
  mergeBoards,
  nextDyadId,
  saveBoard,
  seatParityHolds,
  suggestSeatIds,
  todayISO,
} from "./sessionBoard";
import type { ColorKey, DyadEntry, SessionBoard } from "./sessionBoard";

// The head RA's screen: today's dyads, and which nametag colour goes with which
// study ID.
//
// This is the piece Alex asked for after the lab's walkthrough (2026-08-22):
// whoever hands out the nametags already decides who is who, so they are the
// right person to write it down — once, here — instead of two station RAs
// each typing the same numbers from memory with a participant watching.
//
// The colour is the handle. An RA at a station never types a dyad ID again;
// they tap the colour on the nametag in front of them and the numbers arrive
// with it (see setup/StationSetup.tsx).

/** How often to re-read the board, so both machines see each other's edits. */
const REFRESH_MS = 4000;

/** Ignore a poll that lands just after a local edit and would show the old file. */
const LOCAL_EDIT_GRACE_MS = 5000;

interface Props {
  /** Reports a save failure upward so it lands in the dashboard's error line. */
  onError?: (message: string) => void;
}

function Swatch({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full border border-white/40 shrink-0"
      style={{ backgroundColor: colorHex(color), width: size, height: size }}
    />
  );
}

function ColorPicker({
  value,
  taken,
  onPick,
}: {
  value: ColorKey | "";
  taken: Set<string>;
  onPick: (color: ColorKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NAMETAG_COLORS.map((c) => {
        const isTaken = taken.has(c.key) && value !== c.key;
        return (
          <button
            key={c.key}
            type="button"
            title={isTaken ? `${c.label} — already out today` : c.label}
            aria-label={c.label}
            aria-pressed={value === c.key}
            disabled={isTaken}
            onClick={() => onPick(c.key)}
            className={`w-8 h-8 rounded-full border-2 transition-transform ${
              value === c.key
                ? "border-white scale-110"
                : "border-transparent hover:border-gray-400"
            } ${isTaken ? "opacity-25 cursor-not-allowed" : ""}`}
            style={{ backgroundColor: c.hex }}
          />
        );
      })}
    </div>
  );
}

export default function SessionBoardPanel({ onError }: Props) {
  const [board, setBoard] = useState<SessionBoard>(emptyBoard());
  const [date, setDate] = useState<string>(todayISO());
  const lastLocalEditRef = useRef<number>(0);

  const refresh = useCallback(() => {
    if (Date.now() - lastLocalEditRef.current < LOCAL_EDIT_GRACE_MS) return;
    void loadBoard().then(setBoard);
  }, []);

  useEffect(() => {
    void loadBoard().then(setBoard);
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Both stations write this file. Re-read and merge right before saving, so a
  // dyad added on the other computer is never erased by a save from this one —
  // same rule, and the same reason, as the round-robin store.
  const persist = async (next: SessionBoard) => {
    lastLocalEditRef.current = Date.now();
    setBoard(next);
    try {
      const onDisk = await loadBoard();
      const merged = mergeBoards(onDisk, next);
      // A deletion has to survive the merge, or removing a dyad would undo
      // itself on the next save.
      const keptIds = new Set(next.dyads.map((d) => d.dyadId));
      const removed = onDisk.dyads
        .filter((d) => !keptIds.has(d.dyadId))
        .map((d) => d.dyadId);
      const final: SessionBoard = {
        version: 1,
        dyads: merged.dyads.filter((d) => keptIds.has(d.dyadId) || !removed.includes(d.dyadId)),
      };
      setBoard(final);
      await saveBoard(final);
    } catch (err) {
      console.error("Session board save failed:", err);
      onError?.(`Session board save failed: ${err}`);
    }
  };

  const rows = dyadsOn(board, date);
  const taken = colorsTakenOn(board, date);

  const addDyad = () => {
    const dyadId = nextDyadId(board);
    const ids = suggestSeatIds(dyadId) ?? { left: "", right: "" };
    const free = NAMETAG_COLORS.filter((c) => !taken.has(c.key));
    const entry: DyadEntry = {
      dyadId,
      date,
      time: "",
      left: { color: (free[0]?.key ?? "") as ColorKey | "", participantId: ids.left },
      right: { color: (free[1]?.key ?? "") as ColorKey | "", participantId: ids.right },
      createdAt: new Date().toISOString(),
    };
    void persist({ version: 1, dyads: [...board.dyads, entry] });
  };

  const update = (dyadId: string, patch: (entry: DyadEntry) => DyadEntry) => {
    void persist({
      version: 1,
      dyads: board.dyads.map((d) => (d.dyadId === dyadId && d.date === date ? patch(d) : d)),
    });
  };

  const remove = (dyadId: string) => {
    void persist({
      version: 1,
      dyads: board.dyads.filter((d) => !(d.dyadId === dyadId && d.date === date)),
    });
  };

  return (
    <div className="bg-black border p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
        <div>
          <h2 className="text-white text-xl font-bold">Today's dyads and nametag colours</h2>
          <p className="text-gray-400 text-sm mt-1 max-w-2xl">
            Fill this in when you hand out the nametags. Each rating station
            then reads the dyad and both study IDs off the colour the
            participant is wearing — nobody types a number twice, and the two
            stations cannot disagree about who is in which dyad.
          </p>
        </div>
        <div>
          <label className="block text-gray-400 text-xs mb-1" htmlFor="board-date">
            Day
          </label>
          <input
            id="board-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="p-2 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-6">
          Nothing on the board for {date} yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((entry) => {
            const parityOk = seatParityHolds(entry);
            return (
              <div key={entry.dyadId} className="border border-gray-700 rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-4 mb-3">
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Dyad</label>
                    <input
                      value={entry.dyadId}
                      onChange={(e) => {
                        const nextId = e.target.value.trim();
                        if (!nextId || board.dyads.some((d) => d.dyadId === nextId)) return;
                        const ids = suggestSeatIds(nextId);
                        update(entry.dyadId, (d) => ({
                          ...d,
                          dyadId: nextId,
                          left: { ...d.left, participantId: ids?.left ?? d.left.participantId },
                          right: {
                            ...d.right,
                            participantId: ids?.right ?? d.right.participantId,
                          },
                        }));
                      }}
                      className="w-24 p-2 text-white bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Start time</label>
                    <input
                      value={entry.time}
                      placeholder="10:00"
                      onChange={(e) =>
                        update(entry.dyadId, (d) => ({ ...d, time: e.target.value }))
                      }
                      className="w-24 p-2 text-white bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(entry.dyadId)}
                    className="ml-auto px-3 py-2 text-gray-400 text-xs border border-gray-600 rounded hover:border-red-400 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {(["left", "right"] as const).map((seat) => (
                    <div key={seat}>
                      <p className="text-white text-sm font-semibold mb-2">
                        {seat === "left" ? "Left seat" : "Right seat"}
                        {seat === "left" && (
                          <span className="text-gray-500 font-normal"> · odd ID</span>
                        )}
                      </p>
                      <ColorPicker
                        value={entry[seat].color}
                        taken={taken}
                        onPick={(color) =>
                          update(entry.dyadId, (d) => ({
                            ...d,
                            [seat]: { ...d[seat], color },
                          }))
                        }
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <Swatch color={entry[seat].color} />
                        <input
                          value={entry[seat].participantId}
                          placeholder="Study ID"
                          onChange={(e) =>
                            update(entry.dyadId, (d) => ({
                              ...d,
                              [seat]: { ...d[seat], participantId: e.target.value.trim() },
                            }))
                          }
                          className="w-32 p-2 text-white bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-400"
                        />
                        <span className="text-gray-500 text-xs">
                          {entry[seat].color ? colorLabel(entry[seat].color) : "no colour"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* The counterbalancing rule, checked rather than remembered.
                    Which perspective a participant starts with is keyed off the
                    parity of the left seat's ID, so getting it backwards
                    reverses the design for that dyad and nothing downstream
                    would say so. */}
                {!parityOk && (
                  <p className="text-yellow-400 text-sm mt-3">
                    The left seat's ID ({entry.left.participantId}) is even. The
                    protocol wants the left seat odd — it is what decides which
                    perspective this participant starts with.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addDyad}
        className="mt-4 px-5 py-3 text-white border border-white rounded-lg hover:bg-gray-800 transition-colors"
      >
        + Add a dyad
      </button>
    </div>
  );
}
