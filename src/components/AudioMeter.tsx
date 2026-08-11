import type { AudioLevel } from "../types";

/** Below this, the input is silent for practical purposes — muted or wrong device. */
const SILENCE_LUFS = -60;
/** Speech should sit around here. Much below and the recording will be thin. */
const LOW_LUFS = -40;

const FLOOR = -60;

function fraction(lufs: number): number {
  if (!Number.isFinite(lufs)) return 0;
  return Math.max(0, Math.min(1, (lufs - FLOOR) / -FLOOR));
}

interface Props {
  level: AudioLevel | null;
  enabled: boolean;
  /** Suppresses the "silent" verdict before any audio has been seen at all. */
  live: boolean;
}

/**
 * Level meter driven by the real capture graph (FFmpeg's ebur128 filter), not a
 * separate Web Audio tap on a different stream.
 *
 * That distinction is the entire point. A meter fed from its own getUserMedia
 * stream can bounce happily while the microphone being *recorded* is muted. A
 * silent audio track is the most common way a session is quietly lost, and it
 * is invisible in every other property of the resulting file.
 */
export default function AudioMeter({ level, enabled, live }: Props) {
  if (!enabled) {
    return (
      <div className="text-xs text-[--color-ink-faint]">
        Audio is turned off — this recording will have no sound.
      </div>
    );
  }

  const lufs = level?.momentaryLufs ?? FLOOR;
  const peak = level?.peakDbfs ?? -120;
  const width = fraction(lufs) * 100;
  const silent = live && lufs <= SILENCE_LUFS;
  const quiet = live && !silent && lufs < LOW_LUFS;
  const clipping = peak > -1;

  const barColor = silent
    ? "var(--color-bad)"
    : clipping
      ? "var(--color-bad)"
      : quiet
        ? "var(--color-warn)"
        : "var(--color-good)";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="field-label mb-0">Microphone</span>
        <span className="font-mono text-xs text-[--color-ink-dim]">
          {live && Number.isFinite(lufs) && lufs > -119 ? `${lufs.toFixed(1)} LUFS` : "—"}
        </span>
      </div>

      <div
        className="h-3 w-full overflow-hidden rounded-full bg-[--color-panel]"
        role="meter"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Microphone level"
      >
        <div
          className="h-full rounded-full transition-[width] duration-100"
          style={{ width: `${width}%`, background: barColor }}
        />
      </div>

      {silent && (
        <p className="mt-1.5 text-xs font-semibold text-[--color-bad]">
          No sound is reaching the recording. Check the microphone is the right one and not muted.
        </p>
      )}
      {quiet && (
        <p className="mt-1.5 text-xs text-[--color-warn]">
          Very quiet. Usable, but move the microphone closer if you can.
        </p>
      )}
      {clipping && (
        <p className="mt-1.5 text-xs font-semibold text-[--color-bad]">
          Peaking — the loudest moments are being clipped. Lower the input level.
        </p>
      )}
    </div>
  );
}
