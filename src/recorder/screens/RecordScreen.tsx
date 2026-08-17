import AudioMeter from "../components/AudioMeter";
import PreviewPane from "../components/PreviewPane";
import { Stat, StopButton } from "../components/RecordControls";
import { humanBytes, humanDuration } from "../presets";
import type { AudioLevel, ProgressSnapshot, RecordSettings } from "../types";

interface Props {
  settings: RecordSettings;
  progress: ProgressSnapshot | null;
  audioLevel: AudioLevel | null;
  elapsedMs: number;
  warnings: string[];
  outputPath: string;
  stopping: boolean;
  autoStopMinutes: number | null;
  onStop: () => void;
  /** Puts the participant-facing cover back up. */
  onHide: () => void;
}

/** How long a take may run with zero frames before it is called what it is. */
const NO_SIGNAL_ALARM_MS = 6_000;

/**
 * What the researcher sees after unlocking the cover with Ctrl+Shift+R.
 *
 * The one question this screen exists to answer, before anything else, is
 * "is this take actually capturing?" — so the answer is the headline, not
 * something to infer from a frame counter. A camera that never delivered a
 * frame used to leave a preview box politely saying "Opening the camera…"
 * while the recording captured nothing; now it is a red alarm.
 */
export default function RecordScreen(props: Props) {
  const p = props.progress;
  const frames = p?.frames ?? 0;
  const capturing = frames > 0;
  const noSignalAlarm = !capturing && props.elapsedMs >= NO_SIGNAL_ALARM_MS;

  const dropped = p?.droppedFrames ?? 0;
  const duplicated = p?.duplicatedFrames ?? 0;
  const speed = p?.speed ?? 0;

  // Duplicates are how constant frame rate is held when the camera under-
  // delivers, so a handful is routine. More than a second's worth means the
  // camera is not keeping up and the recording contains repeated material.
  const duplicationIsHeavy = duplicated > props.settings.fps;
  const encoderStruggling = speed > 0 && speed < 0.98;

  const remainingMs =
    props.autoStopMinutes !== null
      ? Math.max(0, props.autoStopMinutes * 60_000 - props.elapsedMs)
      : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      {/* ---- the headline: recording state, elapsed, stop ---- */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span
            className={`block h-3.5 w-3.5 rounded-full ${
              capturing ? "rec-pulse bg-[--color-record]" : "bg-[--color-warn]"
            }`}
            aria-hidden
          />
          <div>
            <p className="text-lg font-semibold">
              {capturing
                ? "Recording"
                : noSignalAlarm
                  ? "NOT capturing"
                  : "Starting the camera…"}
            </p>
            <p className="font-mono text-3xl tabular-nums">
              {humanDuration(props.elapsedMs)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <StopButton onClick={props.onStop} busy={props.stopping} />
          {remainingMs !== null && (
            <p className="text-xs text-[--color-ink-dim]">
              Stops itself in {humanDuration(remainingMs)}
            </p>
          )}
        </div>
      </div>

      {noSignalAlarm && (
        <p className="rounded-lg bg-[--color-bad] px-4 py-3 text-sm font-semibold leading-relaxed text-white">
          No frames have reached the recording. The camera is not delivering —
          this take is empty so far. Press Stop, then check that the webcam is
          plugged in and nothing else (Zoom, Teams, the Camera app) is using
          it. A laptop's built-in camera often cannot record at all — use the
          USB webcam.
        </p>
      )}

      {/* ---- what the camera sees, only when it is actually seeing ---- */}
      {capturing ? (
        <PreviewPane
          active
          overlay={
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
              <span className="rec-pulse block h-2.5 w-2.5 rounded-full bg-[--color-record]" />
              <span className="font-mono text-sm font-semibold tabular-nums text-white">
                {humanDuration(props.elapsedMs)}
              </span>
            </div>
          }
        />
      ) : (
        !noSignalAlarm && (
          <div className="card flex aspect-video w-full items-center justify-center p-6">
            <p className="text-sm text-[--color-ink-dim]">
              Waiting for the first frame from the camera…
            </p>
          </div>
        )
      )}

      <div className="card p-4">
        <AudioMeter level={props.audioLevel} enabled={props.settings.audio !== null} live />
      </div>

      {/* ---- put the cover back before leaving the room ---- */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-[--color-ink-dim]">
          Leaving the room with the take running? Put the participant screen
          back up.
        </p>
        <button
          type="button"
          onClick={props.onHide}
          className="rounded-lg border border-[--color-panel-edge] px-4 py-2 text-sm hover:border-[--color-ink-faint]"
        >
          Hide the screen again
        </button>
      </div>

      <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
        <Stat
          label="Frames"
          value={frames.toLocaleString()}
          tone={capturing ? "good" : "warn"}
          hint={`${(p?.fps ?? 0).toFixed(1)} fps now`}
        />
        <Stat
          label="Dropped"
          value={dropped.toLocaleString()}
          tone={dropped > 0 ? "bad" : "good"}
          hint={
            dropped > 0
              ? `${(dropped / Math.max(1, props.settings.fps)).toFixed(1)} s lost`
              : "none"
          }
        />
        <Stat
          label="Duplicated"
          value={duplicated.toLocaleString()}
          tone={duplicationIsHeavy ? "warn" : "normal"}
          hint={duplicationIsHeavy ? "camera behind" : "normal"}
        />
        <Stat label="Written" value={humanBytes(p?.bytes ?? 0)} />
        <Stat
          label="Encoder"
          value={speed > 0 ? `${speed.toFixed(2)}×` : "—"}
          tone={encoderStruggling ? "warn" : "normal"}
          hint={encoderStruggling ? "at its limit" : "keeping up"}
        />
      </section>

      {/* Drops are a data-quality event, not a log line. Surfaced while there
          is still time to do something about it. */}
      {dropped > 0 && (
        <p className="rounded-lg bg-[--color-bad]/10 px-3 py-2.5 text-sm leading-relaxed text-[--color-bad]">
          <strong>{dropped.toLocaleString()} frames dropped.</strong> That material is gone
          from the recording. If this keeps climbing, note it in the session log.
        </p>
      )}

      {encoderStruggling && dropped === 0 && (
        <p className="rounded-lg bg-[--color-warn]/10 px-3 py-2.5 text-sm leading-relaxed text-[--color-warn]">
          The encoder is running slower than real time. Nothing has been lost yet, but close
          other applications if you can.
        </p>
      )}

      {props.warnings.length > 0 && (
        <section className="card p-4">
          <div className="field-label">FFmpeg messages</div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {props.warnings.slice(-8).map((w, i) => (
              <li key={i} className="font-mono text-[11px] leading-relaxed text-[--color-warn]">
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <div className="field-label">Writing to</div>
        <p className="break-all font-mono text-xs text-[--color-ink-dim]">{props.outputPath}</p>
        <p className="mt-2 text-xs text-[--color-ink-faint]">
          {props.settings.width} × {props.settings.height} · {props.settings.fps} fps ·
          constant frame rate
          {props.settings.inputFormat ? ` · ${props.settings.inputFormat} input` : ""}
        </p>
      </section>
    </div>
  );
}
