import { humanBytes, humanDuration } from "../presets";
import type { ArchiveReport, FinalizeResult, StopOutcome } from "../types";

interface Props {
  outcome: StopOutcome;
  result: FinalizeResult | null;
  archive: ArchiveReport | null;
  finalizing: boolean;
  error: string | null;
  onReveal: () => void;
  onAnother: () => void;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? "bg-[--color-good] text-black" : "bg-[--color-bad] text-white"
        }`}
      >
        {ok ? "✓" : "!"}
      </span>
      <span className={ok ? "text-[--color-ink-dim]" : "text-[--color-bad]"}>{label}</span>
    </li>
  );
}

/**
 * The verdict on a finished take.
 *
 * Written to report rather than to reassure. A recording that dropped frames,
 * recorded silence, or had to be force-stopped says so first and plainly —
 * finding that out now, while the participants may still be in the building,
 * is worth much more than a green tick.
 */
export default function FinishScreen(props: Props) {
  const v = props.result?.verification;
  const clean = v?.ok === true && !props.outcome.forced;

  return (
    <div className="mx-auto max-w-3xl p-5">
      <div className="card p-6">
        {props.finalizing ? (
          <div className="py-10 text-center">
            <p className="text-lg font-semibold">Finishing the recording…</p>
            <p className="mt-2 text-sm text-[--color-ink-dim]">
              Converting to MP4, checking every frame's timing, and computing a checksum.
              Do not close this window.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                  clean ? "bg-[--color-good] text-black" : "bg-[--color-warn] text-black"
                }`}
              >
                {clean ? "✓" : "!"}
              </span>
              <div>
                <h1 className="text-xl font-semibold">
                  {clean ? "Recording verified" : "Recording saved with problems"}
                </h1>
                <p className="mt-1 text-sm leading-relaxed text-[--color-ink-dim]">
                  {props.result?.summary ?? props.error ?? "Verification did not run."}
                </p>
              </div>
            </div>

            {props.outcome.forced && (
              <p className="mt-4 rounded-md bg-[--color-bad]/10 px-3 py-2.5 text-sm leading-relaxed text-[--color-bad]">
                FFmpeg did not stop on request and had to be terminated. The file may be
                incomplete — play it through before relying on it.
              </p>
            )}

            {props.error && (
              <p className="mt-4 rounded-md bg-[--color-bad]/10 px-3 py-2.5 text-sm leading-relaxed text-[--color-bad]">
                {props.error}
              </p>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="field-label">Length</dt>
                <dd className="font-mono text-lg tabular-nums">
                  {humanDuration(props.outcome.wallDurationMs)}
                </dd>
              </div>
              <div>
                <dt className="field-label">Size</dt>
                <dd className="font-mono text-lg tabular-nums">
                  {humanBytes(props.result?.sizeBytes ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="field-label">Frames</dt>
                <dd className="font-mono text-lg tabular-nums">
                  {(v?.frameCount ?? props.outcome.progress.frames).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="field-label">Dropped</dt>
                <dd
                  className={`font-mono text-lg tabular-nums ${
                    props.outcome.progress.droppedFrames > 0
                      ? "text-[--color-bad]"
                      : "text-[--color-good]"
                  }`}
                >
                  {props.outcome.progress.droppedFrames.toLocaleString()}
                </dd>
              </div>
            </dl>

            {v && (
              <ul className="mt-5 space-y-1.5 border-t border-[--color-panel-edge] pt-4">
                <Check
                  ok={v.cfr}
                  label={`Constant frame rate — declared ${v.rFrameRate}, average ${v.avgFrameRate}`}
                />
                <Check
                  ok={v.ptsUniform}
                  label={`Frame timing exact — worst gap off by ${v.maxPtsDeviationMs.toFixed(2)} ms`}
                />
                <Check
                  ok={v.frameCount > 0 && Math.abs(v.frameCount - v.expectedFrameCount) <= 1}
                  label={`${v.frameCount.toLocaleString()} frames over ${v.durationSeconds.toFixed(2)} s (expected about ${v.expectedFrameCount.toLocaleString()})`}
                />
                <Check
                  ok={v.audioPresent && v.audioSilent !== true}
                  label={
                    v.audioPresent
                      ? `Audio present${v.meanVolumeDbfs !== null ? ` at ${v.meanVolumeDbfs.toFixed(1)} dBFS mean` : ""}`
                      : "No audio track"
                  }
                />
              </ul>
            )}

            {props.result && (
              <div className="mt-5 border-t border-[--color-panel-edge] pt-4">
                <div className="field-label">Saved to</div>
                <p className="break-all font-mono text-xs text-[--color-ink-dim]">
                  {props.result.path}
                </p>
                <div className="field-label mt-3">Checksum (SHA-256)</div>
                <p className="break-all font-mono text-[11px] text-[--color-ink-faint]">
                  {props.result.sha256}
                </p>
                <p className="mt-2 text-xs text-[--color-ink-faint]">
                  A matching <span className="font-mono">.json</span> receipt sits beside the
                  video with the camera, encoder, timing, and verification details.
                </p>
              </div>
            )}

            {/* Filing is reported separately from recording, because the two
                succeed and fail independently. A queued copy is not a lost one. */}
            {props.archive && (
              <div className="mt-4 border-t border-[--color-panel-edge] pt-4">
                <div className="field-label">Research Drive &amp; Round Robin</div>
                <p
                  className={`text-sm leading-relaxed ${
                    props.archive.registered
                      ? "text-[--color-good]"
                      : props.archive.queued
                        ? "text-[--color-warn]"
                        : "text-[--color-ink-dim]"
                  }`}
                >
                  {props.archive.message}
                </p>
                {props.archive.archived && (
                  <p className="mt-1 break-all font-mono text-[11px] text-[--color-ink-faint]">
                    {props.archive.archived.destination}
                    {props.archive.archived.verified && " · checksum matched"}
                  </p>
                )}
                {props.archive.queued && (
                  <p className="mt-1 text-xs text-[--color-ink-faint]">
                    It will be retried automatically the next time this app opens, or from the
                    Round Robin panel on the setup screen.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={props.onAnother}
                className="rounded-lg bg-[--color-badger] px-5 py-2.5 font-semibold text-white hover:opacity-90"
              >
                Record another
              </button>
              {props.result && (
                <button
                  type="button"
                  onClick={props.onReveal}
                  className="rounded-lg border border-[--color-panel-edge] px-5 py-2.5 hover:border-[--color-ink-faint]"
                >
                  Show in folder
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {props.outcome.stderrTail && !props.finalizing && (
        <details className="card mt-4 p-4">
          <summary className="cursor-pointer text-sm text-[--color-ink-dim]">
            FFmpeg log
          </summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[--color-ink-faint]">
            {props.outcome.stderrTail}
          </pre>
        </details>
      )}
    </div>
  );
}
