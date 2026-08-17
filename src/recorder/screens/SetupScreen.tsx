import AudioMeter from "../components/AudioMeter";
import PreflightPanel from "../components/PreflightPanel";
import PresetPicker from "../components/PresetPicker";
import PreviewPane from "../components/PreviewPane";
import { RecordButton } from "../components/RecordControls";
import SessionLink from "../components/SessionLink";
import SettingsPanel from "../components/SettingsPanel";
import SpaceReadout from "../components/SpaceReadout";
import type {
  AudioLevel,
  CameraCapabilities,
  CapturePlan,
  Device,
  DeviceList,
  DiskInfo,
  OpenedRecording,
  PreflightReport,
  PublicSettings,
  SessionSummary,
  SpaceEstimate,
} from "../types";

interface Props {
  deviceList: DeviceList | null;
  videoFingerprint: string;
  audioFingerprint: string;
  audioEnabled: boolean;
  capabilities: CameraCapabilities | null;
  plan: CapturePlan | null;
  presetId: string;
  width: number;
  height: number;
  fps: number;
  outputDir: string;
  sessionCode: string;
  sessionMinutes: number;
  estimate: SpaceEstimate | null;
  disk: DiskInfo | null;
  audioLevel: AudioLevel | null;
  previewLive: boolean;
  ffmpegVersion: string;
  profileHash: string;
  blockedReason: string | null;
  error: string | null;
  busy: boolean;
  preflightReport: PreflightReport | null;
  preflightRunning: boolean;
  onPreflight: () => void;

  // Grouped rather than flattened: these are two self-contained panels, and
  // fourteen more positional props would make the call site unreadable.
  roundRobin: {
    configured: boolean;
    sessions: SessionSummary[];
    loading: boolean;
    slotId: string;
    roomIndex: number;
    opened: OpenedRecording | null;
    error: string | null;
    pendingCount: number;
    onSlot: (slotId: string) => void;
    onRoom: (roomIndex: number) => void;
    onRefresh: () => void;
    onClear: () => void;
    onFlush: () => void;
  };
  machineSettings: {
    value: PublicSettings | null;
    saving: boolean;
    onSave: (update: {
      roundRobinUrl?: string;
      roundRobinSecret?: string;
      researchDriveRoot?: string;
    }) => void;
    onPickDriveFolder: () => void;
  };

  onSelectVideo: (fingerprint: string) => void;
  onSelectAudio: (fingerprint: string) => void;
  onToggleAudio: (enabled: boolean) => void;
  onSelectPreset: (id: string) => void;
  onSelectResolution: (width: number, height: number) => void;
  onSelectFps: (fps: number) => void;
  onPickFolder: () => void;
  onSessionCode: (code: string) => void;
  onSessionMinutes: (minutes: number) => void;
  /** Reports whether the preview is genuinely delivering frames. */
  onCameraSignal: (delivering: boolean) => void;
  onRefreshDevices: () => void;
  onRecord: () => void;
}

export default function SetupScreen(props: Props) {
  const cameras = props.deviceList?.devices.filter((d) => d.kind === "video") ?? [];
  const microphones = props.deviceList?.devices.filter((d) => d.kind === "audio") ?? [];
  const camera: Device | undefined = cameras.find(
    (d) => d.fingerprint === props.videoFingerprint
  );

  const ratesForCurrentResolution =
    props.plan?.resolutions.find(
      (r) => r.width === props.width && r.height === props.height
    )?.rates ?? [];

  return (
    <div className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* ---------------- left: what the camera sees ---------------- */}
      <div className="flex flex-col gap-4">
        <PreviewPane active={props.previewLive} onSignal={props.onCameraSignal} />

        <div className="card p-4">
          <AudioMeter
            level={props.audioLevel}
            enabled={props.audioEnabled}
            live={props.previewLive}
          />
        </div>

        <div className="card flex flex-col items-center gap-4 p-6">
          <RecordButton
            onClick={props.onRecord}
            disabled={props.blockedReason !== null || props.busy}
            blockedReason={props.blockedReason}
          />

          {props.error && (
            <p className="w-full rounded-md bg-[--color-bad]/10 px-3 py-2 text-sm text-[--color-bad]">
              {props.error}
            </p>
          )}
        </div>

        <p className="text-center text-xs text-[--color-ink-faint]">
          {props.ffmpegVersion || "FFmpeg not found"} · settings fingerprint{" "}
          <span className="font-mono">{props.profileHash || "…"}</span>
        </p>
      </div>

      {/* ---------------- right: settings ---------------- */}
      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Devices</h2>
            <button
              type="button"
              onClick={props.onRefreshDevices}
              className="text-xs text-[--color-ink-dim] underline hover:text-[--color-ink]"
            >
              Rescan
            </button>
          </div>

          <label className="field-label" htmlFor="camera">
            Camera
          </label>
          <select
            id="camera"
            className="control"
            value={props.videoFingerprint}
            onChange={(e) => props.onSelectVideo(e.target.value)}
            disabled={props.busy}
          >
            <option value="">Select a camera…</option>
            {cameras.map((d) => (
              <option key={d.fingerprint} value={d.fingerprint}>
                {d.name}
                {d.profile ? ` — ${d.profile}` : ""}
              </option>
            ))}
          </select>

          {camera?.profileNote && (
            <p className="mt-2 rounded-md bg-[--color-panel] px-2.5 py-2 text-xs leading-relaxed text-[--color-ink-dim]">
              {camera.profileNote}
            </p>
          )}

          {props.capabilities && !props.capabilities.probed && (
            <p className="mt-2 text-xs leading-relaxed text-[--color-warn]">
              {props.capabilities.note}
            </p>
          )}

          {(props.deviceList?.unreachableCameras.length ?? 0) > 0 && (
            <p className="mt-2 rounded-md bg-[--color-warn]/10 px-2.5 py-2 text-xs leading-relaxed text-[--color-warn]">
              {props.deviceList!.unreachableCameras.join(", ")} exists on this computer but
              cannot be opened for recording — Windows keeps some built-in cameras away from
              recording software. Plug in a USB webcam to use it.
            </p>
          )}

          <div className="mt-3 flex items-center justify-between">
            <label className="field-label mb-0" htmlFor="mic">
              Microphone
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[--color-ink-dim]">
              <input
                type="checkbox"
                checked={props.audioEnabled}
                onChange={(e) => props.onToggleAudio(e.target.checked)}
                disabled={props.busy}
              />
              Record audio
            </label>
          </div>
          <select
            id="mic"
            className="control mt-1.5"
            value={props.audioFingerprint}
            onChange={(e) => props.onSelectAudio(e.target.value)}
            disabled={!props.audioEnabled || props.busy}
          >
            <option value="">Select a microphone…</option>
            {microphones.map((d) => (
              <option key={d.fingerprint} value={d.fingerprint}>
                {d.name}
              </option>
            ))}
          </select>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Quality</h2>
          <PresetPicker
            selectedId={props.presetId}
            sessionMinutes={props.sessionMinutes}
            onSelect={props.onSelectPreset}
            disabled={props.busy}
          />

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="resolution">
                Resolution
              </label>
              <select
                id="resolution"
                className="control"
                value={`${props.width}x${props.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split("x").map(Number);
                  props.onSelectResolution(w, h);
                }}
                disabled={props.busy || !props.plan}
              >
                {(props.plan?.resolutions ?? []).map((r) => (
                  <option key={`${r.width}x${r.height}`} value={`${r.width}x${r.height}`}>
                    {r.width} × {r.height}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="fps">
                Frame rate
              </label>
              <select
                id="fps"
                className="control"
                value={props.fps}
                onChange={(e) => props.onSelectFps(Number(e.target.value))}
                disabled={props.busy || ratesForCurrentResolution.length === 0}
              >
                {ratesForCurrentResolution.map((r) => (
                  <option key={r} value={r}>
                    {r} fps
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Only ever lists combinations the camera itself reported, so this
              message is a statement about the hardware, not a guess. */}
          {props.plan && (
            <p
              className={`mt-2 text-xs leading-relaxed ${
                props.plan.mode ? "text-[--color-ink-dim]" : "text-[--color-bad]"
              }`}
            >
              {props.plan.message}
            </p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Where it goes</h2>

          <label className="field-label" htmlFor="folder">
            Save folder
          </label>
          <div className="flex gap-2">
            <input
              id="folder"
              className="control font-mono text-xs"
              value={props.outputDir}
              readOnly
              placeholder="No folder chosen"
            />
            <button
              type="button"
              onClick={props.onPickFolder}
              disabled={props.busy}
              className="shrink-0 rounded-lg border border-[--color-panel-edge] bg-[--color-panel] px-3 text-sm hover:border-[--color-ink-faint] disabled:opacity-50"
            >
              Choose…
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="code">
                Session code
              </label>
              <input
                id="code"
                className="control"
                value={props.sessionCode}
                onChange={(e) => props.onSessionCode(e.target.value)}
                placeholder="dyad-014-room2"
                disabled={props.busy}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="minutes">
                Planned length
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="minutes"
                  type="number"
                  min={1}
                  max={240}
                  className="control"
                  value={props.sessionMinutes}
                  onChange={(e) => props.onSessionMinutes(Number(e.target.value))}
                  disabled={props.busy}
                />
                <span className="text-sm text-[--color-ink-faint]">min</span>
              </div>
            </div>
          </div>

          {/* No names, no emails, no NetIDs — the lab's rule about identifiers
              applies to filenames as much as to source code. */}
          <p className="mt-2 text-xs text-[--color-ink-faint]">
            Codes only. Never a participant's name, email, or NetID.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Space</h2>
          <SpaceReadout
            estimate={props.estimate}
            disk={props.disk}
            sessionMinutes={props.sessionMinutes}
          />
        </section>

        <PreflightPanel
          report={props.preflightReport}
          running={props.preflightRunning}
          disabled={props.busy || !props.plan?.mode || !props.outputDir}
          onRun={props.onPreflight}
        />

        <SessionLink {...props.roundRobin} disabled={props.busy} />

        <SettingsPanel
          settings={props.machineSettings.value}
          saving={props.machineSettings.saving}
          onSave={props.machineSettings.onSave}
          onPickDriveFolder={props.machineSettings.onPickDriveFolder}
        />

        <section className="card p-4">
          <span className="text-sm font-semibold">What happens when you press Record</span>
          <p className="mt-1 text-xs leading-relaxed text-[--color-ink-dim]">
            The screen immediately shows only &ldquo;Please wait for the
            researcher.&rdquo; — no timer, no counter, no red anything — so the
            recording never distracts the participants. When you come back,
            press <span className="font-mono">Ctrl + Shift + R</span> to bring
            the controls up and stop the take. It also stops itself a few
            minutes after the planned length as a safety net.
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[--color-warn]">
            The camera's own indicator light stays on, and so does the macOS green camera
            dot. Neither can be switched off by any application. Participants must still
            have consented to recording under IRB 2020-1657.
          </p>
        </section>
      </div>
    </div>
  );
}
