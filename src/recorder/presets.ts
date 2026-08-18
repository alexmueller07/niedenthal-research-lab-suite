// Quality presets, and the arithmetic that turns settings into a file size.
//
// A researcher choosing settings should not have to know what a bitrate is.
// Each preset states, in plain words, what it costs and what it costs you —
// and the numbers next to it are computed from the same formula the Rust side
// uses, so the estimate on screen is the estimate that will be enforced.

import type { RateControl, RecordSettings } from "./types";

export interface Preset {
  id: string;
  name: string;
  /** One sentence a non-specialist can act on. */
  blurb: string;
  width: number;
  height: number;
  fps: number;
  videoKbps: number;
  audioKbps: number;
  /** Shown when a preset carries a caveat worth reading before choosing it. */
  caution?: string;
}

// One profile, deliberately.
//
// The lab analyses faces — the whole point of the recordings is subtle
// expression — so the only sane answer to "what quality?" is "as much detail
// as the camera can give", and a choice an RA can get wrong is a choice worth
// removing. A machine left on the old Space Saver profile produced visibly
// blocky video and nobody noticed until it was looked at closely
// (2026-08-17). Storage is the cheapest thing in this pipeline; a mistuned
// recording is the most expensive.
//
// The retired profiles are kept only so a settings file that still names one
// loads without complaint; nothing offers them any more.
export const PRESETS: Preset[] = [
  {
    id: "lab-quality",
    name: "Lab Quality",
    blurb:
      "1080p30, tuned for facial detail. About 1.5 GB for a 10-minute conversation.",
    width: 1920,
    height: 1080,
    fps: 30,
    videoKbps: 20000,
    audioKbps: 192,
  },
];

/** Names that older settings files may still carry. All resolve to the one profile. */
const RETIRED_PRESET_IDS = ["archive", "lab-standard", "space-saver", "minimum"];

export const DEFAULT_PRESET_ID = "lab-quality";

export function presetById(id: string): Preset {
  if (RETIRED_PRESET_IDS.includes(id)) return PRESETS[0];
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Bytes per second at a given constant bitrate.
 *
 * kbps here is kilobits (1000 bits), which is what encoders mean by it, so a
 * byte is bits/8 and the constant is 125. Mirrors
 * RecordSettings::estimated_bytes_per_second on the Rust side.
 */
export function bytesPerSecond(videoKbps: number, audioKbps: number): number {
  return (videoKbps + audioKbps) * 125;
}

/** Null under constant-quality encoding, where size cannot be derived at all. */
export function estimateBytes(
  rateControl: RateControl,
  audioKbps: number,
  seconds: number
): number | null {
  if (rateControl.mode !== "cbr") return null;
  return bytesPerSecond(rateControl.kbps, audioKbps) * seconds;
}

/** Decimal units, matching how drives and operating systems report size. */
export function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function humanDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Turns a preset into capture settings, given a camera and microphone.
 *
 * The resolution and frame rate a preset asks for are only a request: the
 * caller reconciles them against what the camera actually advertised, because
 * this app never asks hardware for a mode it did not claim to support.
 */
export function settingsFromPreset(
  preset: Preset,
  videoToken: string,
  audioToken: string | null,
  inputFormat: string | null,
  inputIsCompressed: boolean
): RecordSettings {
  return {
    videoDeviceToken: videoToken,
    audio: audioToken
      ? {
          deviceToken: audioToken,
          bitrateKbps: preset.audioKbps,
          sampleRate: 48000,
          channels: 2,
        }
      : null,
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    inputFormat,
    inputIsCompressed,
    encoder: "libx264",
    encoderPreset: "veryfast",
    rateControl: { mode: "cbr", kbps: preset.videoKbps },
    gopSeconds: 2,
    container: "crashSafeMkv",
  };
}

/** A short "87 MB/min · ~850 MB for 10 minutes" line for the setup screen. */
export function describeCost(
  rateControl: RateControl,
  audioKbps: number,
  sessionSeconds: number
): string {
  const total = estimateBytes(rateControl, audioKbps, sessionSeconds);
  if (total === null) {
    return "Size cannot be predicted in constant-quality mode — run Calibrate to measure it.";
  }
  const perMinute = estimateBytes(rateControl, audioKbps, 60) ?? 0;
  const minutes = Math.round(sessionSeconds / 60);
  return `${humanBytes(perMinute)}/min · about ${humanBytes(total)} for ${minutes} minutes`;
}
