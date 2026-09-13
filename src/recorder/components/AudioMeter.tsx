import type { AudioLevel } from "../types";

/** Below this, nothing is arriving at all: muted, disconnected, or the wrong device. */
const DEAD_LUFS = -100;
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
      <div className="text-xs text-(--color-ink-faint)">
        Audio is turned off — this recording will have no sound.
      </div>
    );
  }

  // `live` only means FFmpeg started, not that the audio input opened. Until a
  // level has actually arrived there is nothing to judge, and the old code
  // defaulted to exactly the silence threshold — so a failed audio input drew
  // the same red "muted microphone" banner as a muted microphone, under a
  // fabricated "-60.0 LUFS" nothing had measured.
  const measured = live && level !== null;
  const lufs = level?.momentaryLufs ?? FLOOR;
  const peak = level?.peakDbfs ?? -120;
  const width = measured ? fraction(lufs) * 100 : 0;

  // Digital silence floors at -120 (see parse_ebur128_line). A signal that is
  // present but tiny is a different problem with a different fix: both lab
  // rooms measured around -70 LUFS with peaks near -65 dBFS on 2026-09-11,
  // which is a capture level turned down, not a dead microphone.
  const dead = measured && lufs <= DEAD_LUFS;
  const silent = measured && !dead && lufs <= SILENCE_LUFS;
  const quiet = measured && !dead && !silent && lufs < LOW_LUFS;
  const clipping = measured && peak > -1;

  const barColor =
    dead || silent || clipping
      ? "var(--color-bad)"
      : quiet
        ? "var(--color-warn)"
        : "var(--color-good)";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="field-label mb-0">Microphone</span>
        <span className="font-mono text-xs text-(--color-ink-dim)">
          {measured && Number.isFinite(lufs) && lufs > -119 ? `${lufs.toFixed(1)} LUFS` : "—"}
        </span>
      </div>

      <div
        className="h-3 w-full overflow-hidden rounded-full bg-(--color-panel)"
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

      {!measured && live && (
        <p className="mt-1.5 text-xs text-(--color-ink-faint)">
          Waiting for the first reading from the microphone…
        </p>
      )}
      {dead && (
        <p className="mt-1.5 text-xs font-semibold text-(--color-bad)">
          No sound at all is reaching the recording. Check the right microphone is selected, that
          it is plugged in, and that it is not muted.
        </p>
      )}
      {silent && (
        <p className="mt-1.5 text-xs font-semibold text-(--color-bad)">
          The microphone is reaching the recording but is far too quiet to use. Raise its level in
          Windows — Settings → System → Sound → the microphone → Input volume — and check it is
          not muted.
        </p>
      )}
      {quiet && (
        <p className="mt-1.5 text-xs text-(--color-warn)">
          Very quiet. Usable, but move the microphone closer if you can.
        </p>
      )}
      {clipping && (
        <p className="mt-1.5 text-xs font-semibold text-(--color-bad)">
          Peaking — the loudest moments are being clipped. Lower the input level.
        </p>
      )}
    </div>
  );
}
