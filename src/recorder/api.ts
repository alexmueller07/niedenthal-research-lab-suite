// Typed wrappers over the Rust commands.
//
// Every media operation lives in Rust; this module is the only place the
// webview names a command string, so a rename breaks in one file rather than
// twelve.

import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveRecordingInfo,
  ArchiveReport,
  CameraCapabilities,
  CapturePlan,
  ClosePayload,
  DeviceList,
  DeviceRecord,
  DiskInfo,
  FinalizeResult,
  FlushReport,
  OpenedRecording,
  PendingRegistration,
  PreflightReport,
  PublicSettings,
  RecordContext,
  RecordSettings,
  ResolutionOption,
  SessionSummary,
  SettingsUpdate,
  SpaceEstimate,
  StopOutcome,
  VideoMode,
} from "./types";

export const listDevices = () => invoke<DeviceList>("list_devices");

export const probeCamera = (token: string) =>
  invoke<CameraCapabilities>("probe_camera", { token });

/**
 * Which of the camera's advertised modes will actually be used, and what the
 * camera can offer instead when the request cannot be met.
 *
 * The ranking rule lives in Rust so there is one implementation of it. Calling
 * across the boundary for a decision the frontend could make itself is the
 * point: this is the rule that keeps a webcam off its 5 fps uncompressed mode.
 */
export const planCapture = (request: {
  modes: VideoMode[];
  width: number;
  height: number;
  fps: number;
  deviceName: string;
  vendorId: string | null;
  productId: string | null;
}) => invoke<CapturePlan>("plan_capture", { request });

export const recommendMode = (request: {
  modes: VideoMode[];
  width: number;
  height: number;
  fps: number;
  deviceName: string;
  vendorId: string | null;
  productId: string | null;
}) => invoke<ResolutionOption | null>("recommend_mode", { request });

export const ffmpegInfo = () => invoke<string>("ffmpeg_info");

export const startPreview = (settings: RecordSettings) =>
  invoke<void>("start_preview", { settings });

export const stopPreview = () => invoke<void>("stop_preview");

/**
 * Raw JPEG bytes of the latest complete preview frame, or an empty buffer when
 * FFmpeg has not written one yet. Rust filters torn frames, so anything with
 * length here is safe to render.
 */
export const previewFrame = () => invoke<ArrayBuffer>("preview_frame");

export const startRecording = (
  settings: RecordSettings,
  outputDir: string,
  fileStem: string,
  context: RecordContext
) =>
  invoke<string>("start_recording", {
    request: { settings, outputDir, fileStem, context },
  });

export const stopRecording = () => invoke<StopOutcome>("stop_recording");

export const isRecording = () => invoke<boolean>("is_recording");

/**
 * The take that is still running in Rust after the webview lost its state to a
 * reload, or null when nothing is being recorded. Checked once at mount so a
 * reload can never strand a live recording behind a fresh setup screen.
 */
export const activeRecording = () =>
  invoke<ActiveRecordingInfo | null>("active_recording");

/**
 * Records five seconds with the real settings and measures the result.
 * Everything it reports is observed, not inferred from the configuration.
 */
export const preflight = (
  settings: RecordSettings,
  durationSeconds: number,
  outputDir: string
) => invoke<PreflightReport>("preflight", { settings, durationSeconds, outputDir });

export const finalizeRecording = (request: {
  outcome: StopOutcome;
  settings: RecordSettings;
  device: DeviceRecord;
  sessionCode: string | null;
  notes: string | null;
  discreetMode: boolean;
  profileName: string | null;
}) => invoke<FinalizeResult>("finalize_recording", { request });

export const findOrphanedCaptures = (dir: string) =>
  invoke<string[]>("find_orphaned_captures", { dir });

export const diskSpace = (path: string) => invoke<DiskInfo | null>("disk_space", { path });

export const estimateSpace = (
  settings: RecordSettings,
  durationSeconds: number,
  path: string
) =>
  invoke<SpaceEstimate>("estimate_space", {
    request: { settings, durationSeconds, path },
  });

export const profileHash = (settings: RecordSettings) =>
  invoke<string>("profile_hash", { settings });

// --- settings, Research Drive, Round Robin ---------------------------------

// recorder_-prefixed on the Rust side: the PPS station owns the bare
// load_settings/save_settings names (frozen — its frontend ships
// byte-identical with the standalone app), and these two have different
// signatures anyway.
export const loadSettings = () => invoke<PublicSettings>("recorder_load_settings");

export const saveSettings = (update: SettingsUpdate) =>
  invoke<PublicSettings>("recorder_save_settings", { update });

export const rrSessions = () => invoke<SessionSummary[]>("rr_sessions");

/**
 * Opens a Round Robin row *before* the take, so the dyad is stamped from the
 * rotation at capture time rather than reconstructed afterwards from a rotation
 * that may since have changed.
 */
export const rrOpen = (
  slotId: string,
  roomIndex: number,
  round: number | null,
  force: boolean
) => invoke<OpenedRecording>("rr_open", { slotId, roomIndex, round, force });

export const rrPending = () => invoke<PendingRegistration[]>("rr_pending");

export const rrFlush = () => invoke<FlushReport>("rr_flush");

/** Copies to the Research Drive with checksum verification, then closes the row. */
export const archiveRecording = (request: {
  localPath: string;
  sha256: string;
  recordingId: string | null;
  storageKey: string | null;
  payload: ClosePayload;
}) => invoke<ArchiveReport>("archive_recording", { request });
