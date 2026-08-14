import { humanBytes } from "../presets";
import type { DiskInfo, SpaceEstimate } from "../types";

interface Props {
  estimate: SpaceEstimate | null;
  disk: DiskInfo | null;
  sessionMinutes: number;
}

/**
 * What this recording will cost, and whether the drive can take it.
 *
 * Deliberately stated before the take rather than discovered during it: a drive
 * that fills mid-session loses the conversation, and there is no second attempt
 * at a first meeting between two participants.
 */
export default function SpaceReadout({ estimate, disk, sessionMinutes }: Props) {
  if (!estimate) {
    return (
      <p className="text-sm text-[--color-ink-faint]">
        Choose a save folder to see how much space this will use.
      </p>
    );
  }

  const usedFraction =
    disk && disk.totalBytes > 0
      ? 1 - disk.availableBytes / disk.totalBytes
      : 0;
  const projectedFraction =
    disk && disk.totalBytes > 0 && estimate.projectedBytes
      ? estimate.projectedBytes / disk.totalBytes
      : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums">
          {estimate.projectedBytes === null
            ? "unpredictable"
            : humanBytes(estimate.projectedBytes)}
        </span>
        <span className="text-xs text-[--color-ink-dim]">
          for {sessionMinutes} minutes
          {estimate.bytesPerMinute !== null &&
            ` · ${humanBytes(estimate.bytesPerMinute)}/min`}
        </span>
      </div>

      {disk && (
        <>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-[--color-panel]">
            <div
              className="h-full bg-[--color-ink-faint]"
              style={{ width: `${Math.min(100, usedFraction * 100)}%` }}
              title="Already used"
            />
            <div
              className={`h-full ${estimate.fits ? "bg-[--color-good]" : "bg-[--color-bad]"}`}
              style={{ width: `${Math.min(100, projectedFraction * 100)}%` }}
              title="This recording"
            />
          </div>

          <p className="mt-2 text-xs text-[--color-ink-dim]">
            {humanBytes(disk.availableBytes)} free on {disk.mountPoint}
            {estimate.sessionsRemaining !== null && (
              <>
                {" · room for about "}
                <span className="font-semibold text-[--color-ink]">
                  {estimate.sessionsRemaining}
                </span>
                {" more at these settings"}
              </>
            )}
          </p>
        </>
      )}

      {estimate.warning && (
        <p
          className={`mt-2 rounded-md px-2.5 py-2 text-xs leading-relaxed ${
            estimate.fits
              ? "bg-[--color-warn]/10 text-[--color-warn]"
              : "bg-[--color-bad]/10 font-semibold text-[--color-bad]"
          }`}
        >
          {estimate.warning}
        </p>
      )}
    </div>
  );
}
