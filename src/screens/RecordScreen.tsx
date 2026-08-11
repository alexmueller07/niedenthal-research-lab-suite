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
}

export default function RecordScreen(props: Props) {
  const p = props.progress;
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
    <div className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
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

        <div className="card p-4">
          <AudioMeter level={props.audioLevel} enabled={props.settings.audio !== null} live />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col items-center gap-4 p-6">
          <StopButton onClick={props.onStop} busy={props.stopping} />
          {remainingMs !== null && (
            <p className="text-xs text-[--color-ink-dim]">
              Stops automatically in {humanDuration(remainingMs)}
            </p>
          )}
        </div>

        <section className="card grid grid-cols-2 gap-4 p-4">
          <Stat label="Elapsed" value={humanDuration(props.elapsedMs)} />
          <Stat
            label="Frames"
            value={(p?.frames ?? 0).toLocaleString()}
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

        <section className="card p-4">
          <div className="field-label">Writing to</div>
          <p className="break-all font-mono text-xs text-[--color-ink-dim]">
            {props.outputPath}
          </p>
          <p className="mt-2 text-xs text-[--color-ink-faint]">
            {props.settings.width} × {props.settings.height} · {props.settings.fps} fps ·
            constant frame rate
            {props.settings.inputFormat ? ` · ${props.settings.inputFormat} input` : ""}
          </p>
        </section>

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
      </div>
    </div>
  );
}
