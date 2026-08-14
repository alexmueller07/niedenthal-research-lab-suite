interface RecordButtonProps {
  onClick: () => void;
  disabled?: boolean;
  blockedReason?: string | null;
}

/**
 * The one control that has to be unmistakable.
 *
 * Large, red, round, and labelled — not an icon a new RA has to interpret under
 * time pressure with two participants waiting. Keyboard shortcut included
 * because the mouse is often not where the operator's hand is.
 */
export function RecordButton({ onClick, disabled, blockedReason }: RecordButtonProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Start recording"
        className="group flex h-28 w-28 items-center justify-center rounded-full border-4 border-[--color-record-deep] bg-[--color-record] shadow-lg transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:border-[--color-panel-edge] disabled:bg-[--color-panel-raised]"
      >
        <span
          className={`text-lg font-bold tracking-wide ${
            disabled ? "text-[--color-ink-faint]" : "text-white"
          }`}
        >
          RECORD
        </span>
      </button>

      <span className="text-xs text-[--color-ink-faint]">
        {blockedReason ?? "Ctrl + R"}
      </span>
    </div>
  );
}

interface StopButtonProps {
  onClick: () => void;
  busy?: boolean;
}

export function StopButton({ onClick, busy }: StopButtonProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label="Stop recording"
        className="flex h-28 w-28 items-center justify-center rounded-2xl border-4 border-[--color-panel-edge] bg-[--color-panel-raised] shadow-lg transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-60"
      >
        <span className="flex flex-col items-center gap-1.5">
          <span className="block h-7 w-7 rounded-sm bg-[--color-ink]" aria-hidden />
          <span className="text-sm font-bold tracking-wide">
            {busy ? "SAVING" : "STOP"}
          </span>
        </span>
      </button>

      <span className="text-xs text-[--color-ink-faint]">
        {busy ? "Finishing the file — do not close" : "Ctrl + S"}
      </span>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone?: "normal" | "good" | "warn" | "bad";
  hint?: string;
}

export function Stat({ label, value, tone = "normal", hint }: StatProps) {
  const color = {
    normal: "text-[--color-ink]",
    good: "text-[--color-good]",
    warn: "text-[--color-warn]",
    bad: "text-[--color-bad]",
  }[tone];

  return (
    <div>
      <div className="field-label mb-0.5">{label}</div>
      <div className={`font-mono text-lg tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[--color-ink-faint]">{hint}</div>}
    </div>
  );
}
