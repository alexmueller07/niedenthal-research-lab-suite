import type { OpenedRecording, SessionSummary } from "../types";

interface Props {
  configured: boolean;
  sessions: SessionSummary[];
  loading: boolean;
  slotId: string;
  roomIndex: number;
  opened: OpenedRecording | null;
  error: string | null;
  pendingCount: number;
  disabled: boolean;

  onSlot: (slotId: string) => void;
  onRoom: (roomIndex: number) => void;
  onRefresh: () => void;
  onClear: () => void;
  onFlush: () => void;
}

/**
 * Ties a take to a Round Robin session and room.
 *
 * Linking is optional on purpose. A take that cannot reach Round Robin is still
 * a take — it records to the chosen folder and can be filed later. Making the
 * network a precondition for pressing record would mean a Wi-Fi hiccup costs a
 * conversation between two people who have just met, and that conversation
 * cannot be run again.
 */
export default function SessionLink(props: Props) {
  const selected = props.sessions.find((s) => s.slotId === props.slotId);

  if (!props.configured) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Round Robin</h2>
        <p className="mt-1 text-xs leading-relaxed text-[--color-ink-dim]">
          Not configured. Recordings save to the folder above and stay on this computer.
          Add the Round Robin address and shared secret in Settings to file them
          automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Round Robin</h2>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loading}
          className="text-xs text-[--color-ink-dim] underline hover:text-[--color-ink] disabled:opacity-50"
        >
          {props.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <label className="field-label" htmlFor="slot">
        Session
      </label>
      <select
        id="slot"
        className="control"
        value={props.slotId}
        onChange={(e) => props.onSlot(e.target.value)}
        disabled={props.disabled || props.opened !== null}
      >
        <option value="">Not linked — save locally only</option>
        {props.sessions.map((s) => (
          <option key={s.slotId} value={s.slotId}>
            {s.date}
            {s.time ? ` ${s.time}` : ""} · {s.roomCount} room
            {s.roomCount === 1 ? "" : "s"}
            {s.currentRound > 0 ? ` · round ${s.currentRound}` : " · not started"}
          </option>
        ))}
      </select>

      {selected && (
        <>
          <label className="field-label mt-3" htmlFor="room">
            Room
          </label>
          <select
            id="room"
            className="control"
            value={props.roomIndex}
            onChange={(e) => props.onRoom(Number(e.target.value))}
            disabled={props.disabled || props.opened !== null}
          >
            {Array.from({ length: selected.roomCount }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Room {i + 1}
              </option>
            ))}
          </select>

          {selected.currentRound === 0 && (
            <p className="mt-2 text-xs leading-relaxed text-[--color-warn]">
              This session has not started a round yet. Generate the rotation in the Control
              Center first, or the recording will not route to anyone.
            </p>
          )}
        </>
      )}

      {props.opened && (
        <div className="mt-3 rounded-md bg-[--color-panel] px-2.5 py-2">
          <p className="text-xs text-[--color-good]">
            Linked — round {props.opened.round}, room {props.opened.roomIndex}
          </p>
          {props.opened.unassigned && (
            <p className="mt-1 text-xs leading-relaxed text-[--color-warn]">
              The rotation has nobody in this room for this round, so the recording will not
              route to a rating station. Check the session and room.
            </p>
          )}
          <p className="mt-1 break-all font-mono text-[10px] text-[--color-ink-faint]">
            {props.opened.storageKey}
          </p>
          <button
            type="button"
            onClick={props.onClear}
            className="mt-1.5 text-xs text-[--color-ink-dim] underline hover:text-[--color-ink]"
          >
            Unlink
          </button>
        </div>
      )}

      {props.error && (
        <p className="mt-2 rounded-md bg-[--color-warn]/10 px-2.5 py-2 text-xs leading-relaxed text-[--color-warn]">
          {props.error} Recording still works — the take will be filed when the connection
          comes back.
        </p>
      )}

      {props.pendingCount > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-[--color-warn]/10 px-2.5 py-2">
          <span className="text-xs text-[--color-warn]">
            {props.pendingCount} recording{props.pendingCount === 1 ? "" : "s"} waiting to be
            filed
          </span>
          <button
            type="button"
            onClick={props.onFlush}
            className="shrink-0 text-xs font-semibold text-[--color-warn] underline"
          >
            Retry now
          </button>
        </div>
      )}
    </section>
  );
}
