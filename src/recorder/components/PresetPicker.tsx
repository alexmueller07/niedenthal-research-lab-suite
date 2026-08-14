import { PRESETS, estimateBytes, humanBytes } from "../presets";

interface Props {
  selectedId: string;
  sessionMinutes: number;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/**
 * Quality choice presented as consequences rather than codec settings.
 *
 * Every card carries the actual size for the session length that is configured,
 * because "12000 kbps" means nothing to most of the people who will run this
 * and "about 850 MB" means something to all of them.
 */
export default function PresetPicker({
  selectedId,
  sessionMinutes,
  onSelect,
  disabled,
}: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PRESETS.map((preset) => {
        const total = estimateBytes(
          { mode: "cbr", kbps: preset.videoKbps },
          preset.audioKbps,
          sessionMinutes * 60
        );
        const perMinute = estimateBytes(
          { mode: "cbr", kbps: preset.videoKbps },
          preset.audioKbps,
          60
        );
        const selected = preset.id === selectedId;

        return (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(preset.id)}
            aria-pressed={selected}
            className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
              selected
                ? "border-[--color-badger] bg-[--color-panel]"
                : "border-[--color-panel-edge] bg-[--color-panel] hover:border-[--color-ink-faint]"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{preset.name}</span>
              <span className="font-mono text-xs text-[--color-ink-dim]">
                {preset.height}p{preset.fps}
              </span>
            </div>

            <p className="mt-1 text-xs leading-relaxed text-[--color-ink-dim]">
              {preset.blurb}
            </p>

            <p className="mt-2 font-mono text-xs text-[--color-ink]">
              {humanBytes(total ?? 0)}
              <span className="text-[--color-ink-faint]">
                {" "}
                for {sessionMinutes} min · {humanBytes(perMinute ?? 0)}/min
              </span>
            </p>

            {preset.caution && (
              <p className="mt-2 text-xs leading-relaxed text-[--color-warn]">
                {preset.caution}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
