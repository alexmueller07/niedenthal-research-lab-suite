// TypeScript mirrors of the Rust types in src-tauri/src/.
//
// These are hand-kept rather than generated. If a field name changes on the
// Rust side, serde will happily send the new name and TypeScript will silently
// see `undefined` — so any change here needs the matching change there.

export type DeviceKind = "video" | "audio";

export interface Device {
  kind: DeviceKind;
  name: string;
  /** What FFmpeg is given for this session. */
  token: string;
  /** Stable identity used to re-find this device on a later run. */
  fingerprint: string;
  vendorId: string | null;
  productId: string | null;
  /** Label of a matched entry in the device profile table, if any. */
  profile: string | null;
  profileNote: string | null;
}

export interface VideoMode {
  /** `mjpeg`, `nv12`, `yuyv422`, ... or `auto` when the backend won't say. */
  format: string;
  compressed: boolean;
  width: number;
  height: number;
  minFps: number;
  maxFps: number;
}

export interface CameraCapabilities {
  modes: VideoMode[];
  /** False when these are a standard ladder, not the camera's own answer. */
  probed: boolean;
  note: string;
}

export interface DeviceList {
  devices: Device[];
  unreachableCameras: string[];
  backend: string;
}

export interface ResolutionOption {
  width: number;
  height: number;
  rates: number[];
}

export interface CapturePlan {
  /** Null when the camera never advertised the requested combination. */
  mode: VideoMode | null;
  resolutions: ResolutionOption[];
  message: string;
  profile: string | null;
}

export type RateControl =
  | { mode: "cbr"; kbps: number }
  | { mode: "crf"; crf: number };

export type ContainerStrategy = "crashSafeMkv" | "directMp4";

export interface AudioSettings {
  deviceToken: string;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
}

export interface RecordSettings {
  videoDeviceToken: string;
  /** null means video-only — always an explicit choice, never a default. */
  audio: AudioSettings | null;
  width: number;
  height: number;
  fps: number;
  inputFormat: string | null;
  inputIsCompressed: boolean;
  encoder: string;
  encoderPreset: string;
  rateControl: RateControl;
  gopSeconds: number;
  container: ContainerStrategy;
}

export interface ProgressSnapshot {
  frames: number;
  fps: number;
  droppedFrames: number;
  duplicatedFrames: number;
  bytes: number;
  outTimeUs: number;
  bitrateKbps: number;
  /** Below 1.0 means the encoder is not keeping up with the camera. */
  speed: number;
}

export interface AudioLevel {
  momentaryLufs: number;
  peakDbfs: number;
}

export interface StopOutcome {
  capturePath: string;
  startedAt: string;
  endedAt: string;
  wallDurationMs: number;
  progress: ProgressSnapshot;
  exitCode: number | null;
  /** True when FFmpeg had to be killed — file integrity is in doubt. */
  forced: boolean;
  stderrTail: string;
  container: ContainerStrategy;
  /** The encoder that actually ran, resolved by Rust at record time. */
  encoder: string;
}

export interface Verification {
  ok: boolean;
  cfr: boolean;
  ptsUniform: boolean;
  audioPresent: boolean;
  audioSilent: boolean | null;
  rFrameRate: string;
  avgFrameRate: string;
  nominalFps: number;
  frameCount: number;
  expectedFrameCount: number;
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  sizeBytes: number;
  maxPtsDeviationMs: number;
  meanVolumeDbfs: number | null;
  problems: string[];
}

export interface FinalizeResult {
  path: string;
  manifestPath: string;
  sizeBytes: number;
  sha256: string;
  verification: Verification;
  summary: string;
}

export interface DiskInfo {
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
}

export interface SpaceEstimate {
  projectedBytes: number | null;
  bytesPerMinute: number | null;
  availableBytes: number;
  sessionsRemaining: number | null;
  fits: boolean;
  warning: string | null;
}

export interface PreflightCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  checks: PreflightCheck[];
  achievedFps: number;
  framesDropped: number;
  encoderSpeed: number;
}

export interface PublicSettings {
  outputDir: string | null;
  presetId: string | null;
  sessionMinutes: number | null;
  discreet: boolean;
  /** The Round Robin room this machine records — remembered per machine. */
  roomIndex: number | null;
  roundRobinUrl: string | null;
  researchDriveRoot: string | null;
  /** Whether a shared secret exists. The secret itself never leaves Rust. */
  roundRobinSecretConfigured: boolean;
}

export interface SettingsUpdate {
  outputDir?: string;
  presetId?: string;
  sessionMinutes?: number;
  discreet?: boolean;
  roomIndex?: number;
  roundRobinUrl?: string;
  /** Empty string clears it; omitting the field leaves it untouched. */
  roundRobinSecret?: string;
  researchDriveRoot?: string;
}

export interface SessionSummary {
  slotId: string;
  date: string;
  time: string | null;
  roomCount: number;
  currentRound: number;
}

export interface OpenedRecording {
  id: string;
  storageKey: string;
  round: number;
  roomIndex: number;
  participantA: string | null;
  participantB: string | null;
  /** The rotation has no pair in this room this round. */
  unassigned: boolean;
}

export interface ClosePayload {
  durationMs: number;
  captureFps: number;
  framesDropped: number;
  framesDuplicated: number;
  sha256: string;
  profileHash: string;
  recorderVersion: string;
  cfr: boolean;
  /** Size of the verified MP4, for servers that cannot see the drive share. */
  bytes: number;
}

export interface ArchiveOutcome {
  destination: string;
  bytes: number;
  verified: boolean;
  sha256: string;
}

export interface ArchiveReport {
  archived: ArchiveOutcome | null;
  registered: boolean;
  queued: boolean;
  message: string;
}

export interface PendingRegistration {
  recordingId: string;
  storageKey: string;
  localPath: string;
  archived: boolean;
  attempts: number;
  lastError: string | null;
  queuedAt: string;
}

export interface FlushReport {
  attempted: number;
  succeeded: number;
  stillPending: number;
  errors: string[];
}

export interface DeviceRecord {
  name: string;
  fingerprint: string;
  vendorId: string | null;
  productId: string | null;
  profile: string | null;
}

/**
 * Everything the frontend needs to rebuild its recording screen if the webview
 * reloads mid-take. Sent to Rust at record start, held for the length of the
 * take, and handed back by `active_recording`. Rust never reads it.
 */
export interface RecordContext {
  sessionCode: string;
  discreet: boolean;
  presetId: string;
  profileHash: string;
  opened: OpenedRecording | null;
  device: DeviceRecord;
}

export interface ActiveRecordingInfo {
  capturePath: string;
  startedAt: string;
  elapsedMs: number;
  settings: RecordSettings;
  context: RecordContext | null;
}
