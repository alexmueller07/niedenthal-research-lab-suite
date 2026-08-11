import type { PreflightReport } from "../types";

interface Props {
  report: PreflightReport | null;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}

/**
 * Five seconds of the real thing, measured.
 *
 * Every other reassurance this app offers is derived from settings. This one is
 * derived from a capture that actually happened — same device, same mode, same
 * encoder — which is the difference between "this should work" and "this did
 * work, thirty seconds ago, on this machine."
 */
export default function PreflightPanel({ report, running, disabled, onRun }: Props) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Preflight</h2>
          <p className="mt-0.5 text-xs text-[--color-ink-dim]">
            Records five seconds and throws it away, to prove this machine can hold these
            settings before anyone is in the room.
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={disabled || running}
          className="shrink-0 rounded-lg border border-[--color-panel-edge] bg-[--color-panel] px-3 py-2 text-sm hover:border-[--color-ink-faint] disabled:opacity-50"
        >
          {running ? "Testing…" : "Run check"}
        </button>
      </div>

      {report && !running && (
        <ul className="mt-3 space-y-2 border-t border-[--color-panel-edge] pt-3">
          {report.checks.map((check) => (
            <li key={check.label} className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  check.passed ? "bg-[--color-good] text-black" : "bg-[--color-bad] text-white"
                }`}
              >
                {check.passed ? "✓" : "!"}
              </span>
              <span className="text-xs leading-relaxed">
                <span className={check.passed ? "text-[--color-ink]" : "text-[--color-bad]"}>
                  {check.label}
                </span>
                <span className="text-[--color-ink-faint]"> — {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
