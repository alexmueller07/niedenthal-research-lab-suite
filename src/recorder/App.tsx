import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import * as api from "./api";
import DiscreetOverlay from "./components/DiscreetOverlay";
import { fileStem, identifierWarning } from "./naming";
import { DEFAULT_PRESET_ID, presetById, settingsFromPreset } from "./presets";
import FinishScreen from "./screens/FinishScreen";
import RecordScreen from "./screens/RecordScreen";
import SetupScreen from "./screens/SetupScreen";
import type {
  ArchiveReport,
  AudioLevel,
  CameraCapabilities,
  CapturePlan,
  DeviceList,
  DeviceRecord,
  DiskInfo,
  FinalizeResult,
  OpenedRecording,
  PreflightReport,
  ProgressSnapshot,
  PublicSettings,
  RecordSettings,
  SessionSummary,
  SpaceEstimate,
  StopOutcome,
} from "./types";

type Phase = "setup" | "recording" | "finishing" | "done";

/** Grace beyond the planned length before discreet mode stops itself. */
const DISCREET_AUTO_STOP_GRACE_MINUTES = 5;

export default function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);

  const [deviceList, setDeviceList] = useState<DeviceList | null>(null);
  const [ffmpegVersion, setFfmpegVersion] = useState("");
  const [videoFingerprint, setVideoFingerprint] = useState("");
  const [audioFingerprint, setAudioFingerprint] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);

  const [capabilities, setCapabilities] = useState<CameraCapabilities | null>(null);
  const [plan, setPlan] = useState<CapturePlan | null>(null);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);

  const [outputDir, setOutputDir] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState(10);
  const [discreet, setDiscreet] = useState(false);
  const [discreetActive, setDiscreetActive] = useState(false);

  const [estimate, setEstimate] = useState<SpaceEstimate | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [profileHash, setProfileHash] = useState("");

  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [audioLevel, setAudioLevel] = useState<AudioLevel | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewLive, setPreviewLive] = useState(false);

  const [machineSettings, setMachineSettings] = useState<PublicSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [slotId, setSlotId] = useState("");
  const [roomIndex, setRoomIndex] = useState(1);
  const [opened, setOpened] = useState<OpenedRecording | null>(null);
  const [rrError, setRrError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [archiveReport, setArchiveReport] = useState<ArchiveReport | null>(null);

  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  /** Bumped to force the preview to respawn after something else took the camera. */
  const [previewNonce, setPreviewNonce] = useState(0);

  const [outputPath, setOutputPath] = useState("");
  const [startedAtMs, setStartedAtMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [outcome, setOutcome] = useState<StopOutcome | null>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);

  /**
   * Set when the webview reloaded while a take was running. Rust's copy of the
   * settings and device is authoritative from then on — the rebuilt camera
   * state may have defaulted to a different device than the one recording.
   */
  const [recovered, setRecovered] = useState<{
    settings: RecordSettings;
    device: DeviceRecord;
  } | null>(null);
  const recoveredDiscreet = useRef(false);

  const camera = deviceList?.devices.find(
    (d) => d.kind === "video" && d.fingerprint === videoFingerprint
  );
  const microphone = deviceList?.devices.find(
    (d) => d.kind === "audio" && d.fingerprint === audioFingerprint
  );

  const settings: RecordSettings | null = useMemo(() => {
    if (!camera) return null;
    const preset = presetById(presetId);
    const base = settingsFromPreset(
      preset,
      camera.token,
      audioEnabled && microphone ? microphone.token : null,
      plan?.mode?.format === "auto" ? null : (plan?.mode?.format ?? null),
      plan?.mode?.compressed ?? false
    );
    // Resolution and frame rate come from what the camera advertised, not from
    // the preset — the preset only expresses a quality intent.
    return { ...base, width, height, fps };
  }, [camera, microphone, audioEnabled, presetId, plan, width, height, fps]);

  // ---- initial load -------------------------------------------------------

  const refreshDevices = useCallback(async () => {
    try {
      const list = await api.listDevices();
      setDeviceList(list);
      setError(null);
      const firstCamera = list.devices.find((d) => d.kind === "video");
      const firstMic = list.devices.find((d) => d.kind === "audio");
      setVideoFingerprint((current) =>
        current && list.devices.some((d) => d.fingerprint === current)
          ? current
          : (firstCamera?.fingerprint ?? "")
      );
      setAudioFingerprint((current) =>
        current && list.devices.some((d) => d.fingerprint === current)
          ? current
          : (firstMic?.fingerprint ?? "")
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshPending = useCallback(() => {
    void api
      .rrPending()
      .then((q) => setPendingCount(q.length))
      .catch(() => setPendingCount(0));
  }, []);

  const refreshSessions = useCallback(() => {
    setSessionsLoading(true);
    void api
      .rrSessions()
      .then((s) => {
        setSessions(s);
        setRrError(null);
      })
      .catch((e) => {
        setSessions([]);
        setRrError(String(e));
      })
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    void refreshDevices();
    api.ffmpegInfo().then(setFfmpegVersion).catch(() => setFfmpegVersion(""));
    void api
      .loadSettings()
      .then((s) => {
        setMachineSettings(s);
        if (s.outputDir) setOutputDir(s.outputDir);
        if (s.presetId) setPresetId(s.presetId);
        if (s.sessionMinutes) setSessionMinutes(s.sessionMinutes);
        if (s.roomIndex) setRoomIndex(s.roomIndex);
        if (!recoveredDiscreet.current) setDiscreet(s.discreet);
        settingsLoaded.current = true;
        // Only reach for the network once there is something to reach with.
        if (s.roundRobinUrl && s.roundRobinSecretConfigured) refreshSessions();
      })
      .catch(() => {
        settingsLoaded.current = true;
      });
    refreshPending();
  }, [refreshDevices, refreshSessions, refreshPending]);

  // If the webview reloaded mid-take — a crash, a stray browser shortcut on a
  // build without the WebView2 fix — the take is still running in Rust. Rebuild
  // the recording screen around it instead of stranding it behind a fresh setup
  // screen with a Stop button nobody can reach.
  useEffect(() => {
    void api
      .activeRecording()
      .then((info) => {
        if (!info) return;
        const ctx = info.context;
        setRecovered({
          settings: info.settings,
          device: ctx?.device ?? {
            name: "unknown",
            fingerprint: "",
            vendorId: null,
            productId: null,
            profile: null,
          },
        });
        setOutputPath(info.capturePath);
        setStartedAtMs(Date.now() - info.elapsedMs);
        setElapsedMs(info.elapsedMs);
        if (ctx) {
          setSessionCode(ctx.sessionCode);
          setPresetId(ctx.presetId);
          setProfileHash(ctx.profileHash);
          setOpened(ctx.opened);
          recoveredDiscreet.current = true;
          setDiscreet(ctx.discreet);
          // Participants may still be in the room: come back hidden, exactly
          // as the screen was before the reload.
          setDiscreetActive(ctx.discreet);
        }
        setPhase("recording");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the operator's choices between sessions. Debounced so typing in
  // the length field does not write the file on every keystroke, and gated on
  // the initial load so the defaults never overwrite what was saved.
  const settingsLoaded = useRef(false);
  useEffect(() => {
    if (!settingsLoaded.current) return;
    const timer = setTimeout(() => {
      void api
        .saveSettings({
          // An empty folder means "not chosen yet", not "clear the saved one".
          ...(outputDir ? { outputDir } : {}),
          presetId,
          sessionMinutes,
          discreet,
          roomIndex,
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [outputDir, presetId, sessionMinutes, discreet, roomIndex]);

  // The session list arrives sorted today-first. An RA standing in a
  // conversation room should not have to pick "today" from a dropdown every
  // single session — preselect it, leave the dropdown for the exceptions.
  useEffect(() => {
    if (!slotId && sessions.length > 0) {
      setSlotId(sessions[0].slotId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  // The launch-time flush retries anything a previous session left queued.
  useEffect(() => {
    const unlisten = listen("registrations-flushed", () => refreshPending());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshPending]);

  // ---- camera capabilities ------------------------------------------------

  useEffect(() => {
    if (!camera) {
      setCapabilities(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const caps = await api.probeCamera(camera.token);
        if (cancelled) return;
        setCapabilities(caps);

        // Land on something this camera can actually do before showing any
        // numbers, rather than defaulting to 1080p and hoping.
        const best = await api.recommendMode({
          modes: caps.modes,
          width: 1920,
          height: 1080,
          fps: 30,
          deviceName: camera.name,
          vendorId: camera.vendorId,
          productId: camera.productId,
        });
        if (cancelled || !best) return;
        setWidth(best.width);
        setHeight(best.height);
        setFps(best.rates[0] ?? 30);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [camera]);

  useEffect(() => {
    if (!camera || !capabilities) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void api
      .planCapture({
        modes: capabilities.modes,
        width,
        height,
        fps,
        deviceName: camera.name,
        vendorId: camera.vendorId,
        productId: camera.productId,
      })
      .then((p) => !cancelled && setPlan(p))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [camera, capabilities, width, height, fps]);

  // ---- space and profile fingerprint --------------------------------------

  useEffect(() => {
    if (!settings || !outputDir) {
      setEstimate(null);
      setDisk(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [e, d, hash] = await Promise.all([
          api.estimateSpace(settings, sessionMinutes * 60, outputDir),
          api.diskSpace(outputDir),
          api.profileHash(settings),
        ]);
        if (cancelled) return;
        setEstimate(e);
        setDisk(d);
        setProfileHash(hash);
      } catch {
        // A failed estimate is not worth blocking the screen over; the hard
        // space check runs again at record time.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, outputDir, sessionMinutes]);

  // ---- preview ------------------------------------------------------------

  // Only the settings that change what FFmpeg negotiates with the camera.
  // Restarting the preview when a bitrate slider moves would make the picture
  // flicker for no reason.
  const hasMode = Boolean(plan?.mode);
  const previewKey = settings
    ? [
        settings.videoDeviceToken,
        settings.audio?.deviceToken ?? "none",
        settings.width,
        settings.height,
        settings.fps,
        settings.inputFormat ?? "auto",
      ].join("|")
    : "";

  useEffect(() => {
    if (phase !== "setup" || !settings || !plan?.mode) {
      setPreviewLive(false);
      return;
    }
    let cancelled = false;
    // Debounced: flicking through resolutions would otherwise spawn a process
    // per keystroke, and each one grabs the camera.
    const timer = setTimeout(() => {
      void api
        .startPreview(settings)
        .then(() => !cancelled && setPreviewLive(true))
        .catch((e) => {
          if (!cancelled) {
            setPreviewLive(false);
            setError(String(e));
          }
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPreviewLive(false);
      void api.stopPreview().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, previewKey, hasMode, previewNonce]);

  // ---- events from the capture process ------------------------------------

  useEffect(() => {
    const unlisten = [
      listen<ProgressSnapshot>("recording-progress", (e) => setProgress(e.payload)),
      listen<AudioLevel>("recording-audio", (e) => setAudioLevel(e.payload)),
      listen<string>("recording-warning", (e) =>
        setWarnings((w) => (w[w.length - 1] === e.payload ? w : [...w, e.payload]))
      ),
      listen("close-blocked", () =>
        setError(
          "A recording is still running. Press Stop first — closing now would cut the file short."
        )
      ),
    ];
    return () => {
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  // ---- elapsed clock ------------------------------------------------------

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtMs), 200);
    return () => clearInterval(timer);
  }, [phase, startedAtMs]);

  // ---- actions ------------------------------------------------------------

  const handleStop = useCallback(async () => {
    if (phase !== "recording" || stopping) return;
    // After a mid-take reload, Rust's copy of the settings and device is the
    // truth — the rebuilt camera state may point at a different device.
    const liveSettings = recovered?.settings ?? settings;
    if (!liveSettings) return;
    const liveDevice: DeviceRecord = recovered?.device ?? {
      name: camera?.name ?? "unknown",
      fingerprint: camera?.fingerprint ?? "",
      vendorId: camera?.vendorId ?? null,
      productId: camera?.productId ?? null,
      profile: camera?.profile ?? null,
    };
    setStopping(true);
    setDiscreetActive(false);
    try {
      const stopped = await api.stopRecording();
      setOutcome(stopped);
      setPhase("finishing");
      setError(null);

      const finalized = await api.finalizeRecording({
        outcome: stopped,
        settings: liveSettings,
        device: liveDevice,
        sessionCode: sessionCode || null,
        notes: null,
        discreetMode: discreet,
        profileName: presetById(presetId).name,
      });
      setResult(finalized);

      // The local file is complete and verified at this point. Everything from
      // here — the Research Drive copy, the Round Robin row — can fail without
      // costing the recording, and is queued for retry if it does.
      const report = await api.archiveRecording({
        localPath: finalized.path,
        sha256: finalized.sha256,
        recordingId: opened?.id ?? null,
        storageKey: opened?.storageKey ?? null,
        payload: {
          durationMs: stopped.wallDurationMs,
          captureFps: liveSettings.fps,
          framesDropped: stopped.progress.droppedFrames,
          framesDuplicated: stopped.progress.duplicatedFrames,
          sha256: finalized.sha256,
          profileHash,
          recorderVersion: "",
          cfr: finalized.verification.cfr,
          bytes: finalized.sizeBytes,
        },
      });
      setArchiveReport(report);
      setOpened(null);
      setRecovered(null);
      refreshPending();
    } catch (e) {
      setError(String(e));
    } finally {
      setStopping(false);
      setPhase("done");
    }
  }, [
    phase,
    stopping,
    settings,
    recovered,
    camera,
    sessionCode,
    discreet,
    presetId,
    opened,
    profileHash,
    refreshPending,
  ]);

  const handlePreflight = useCallback(async () => {
    if (!settings || !outputDir || preflightRunning) return;
    setPreflightRunning(true);
    setPreviewLive(false);
    setError(null);
    try {
      setPreflightReport(await api.preflight(settings, sessionMinutes * 60, outputDir));
    } catch (e) {
      setError(String(e));
      setPreflightReport(null);
    } finally {
      setPreflightRunning(false);
      // Preflight takes the camera to run its own capture, so the preview has
      // to be respawned rather than left showing a frozen last frame.
      setPreviewNonce((n) => n + 1);
    }
  }, [settings, outputDir, sessionMinutes, preflightRunning]);

  const handleRecord = useCallback(async () => {
    if (!settings || !outputDir || phase !== "setup") return;
    setError(null);
    try {
      // The preview holds the camera. On Windows a DirectShow device is
      // usually exclusive access, so the record spawn fails outright if the
      // preview is still attached.
      // Open the Round Robin row first, so the dyad is stamped from the
      // rotation as it stands right now. Doing it afterwards would risk
      // stamping a round that has since advanced.
      //
      // A failure here is reported and then ignored: the take proceeds
      // unlinked rather than not happening at all.
      let linked = opened;
      if (slotId && !linked) {
        try {
          linked = await api.rrOpen(slotId, roomIndex, null, false);
          setOpened(linked);
          setRrError(null);
        } catch (e) {
          setRrError(String(e));
        }
      }

      await api.stopPreview();
      setPreviewLive(false);

      const path = await api.startRecording(
        settings,
        outputDir,
        fileStem(sessionCode, new Date()),
        // Held by Rust for the length of the take, so a webview reload can
        // rebuild this screen exactly as it was.
        {
          sessionCode,
          discreet,
          presetId,
          profileHash,
          opened: linked,
          device: {
            name: camera?.name ?? "unknown",
            fingerprint: camera?.fingerprint ?? "",
            vendorId: camera?.vendorId ?? null,
            productId: camera?.productId ?? null,
            profile: camera?.profile ?? null,
          },
        }
      );
      setOutputPath(path);
      setProgress(null);
      setWarnings([]);
      setResult(null);
      setOutcome(null);
      setStartedAtMs(Date.now());
      setElapsedMs(0);
      setPhase("recording");
      if (discreet) setDiscreetActive(true);
    } catch (e) {
      setError(String(e));
    }
  }, [
    settings,
    outputDir,
    sessionCode,
    discreet,
    phase,
    slotId,
    roomIndex,
    opened,
    presetId,
    profileHash,
    camera,
  ]);

  // ---- discreet mode auto-stop -------------------------------------------

  const autoStopMinutes = discreet ? sessionMinutes + DISCREET_AUTO_STOP_GRACE_MINUTES : null;

  const stopRef = useRef(handleStop);
  stopRef.current = handleStop;

  useEffect(() => {
    if (phase !== "recording" || autoStopMinutes === null) return;
    // A recording nobody can see must not be able to run forever. This is the
    // price of hiding the indicator, and it is not optional.
    const remaining = autoStopMinutes * 60_000 - elapsedMs;
    if (remaining <= 0) void stopRef.current();
  }, [phase, autoStopMinutes, elapsedMs]);

  // ---- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // metaKey so the chords work on the lab Mac too (Cmd instead of Ctrl).
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setDiscreetActive(false);
        return;
      }
      if (discreetActive) return; // nothing else is reachable while hidden
      if (mod && e.key.toLowerCase() === "r" && phase === "setup") {
        e.preventDefault();
        void handleRecord();
      }
      if (mod && e.key.toLowerCase() === "s" && phase === "recording") {
        e.preventDefault();
        void handleStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [discreetActive, phase, handleRecord, handleStop]);

  // ---- what blocks recording ---------------------------------------------

  const codeWarning = identifierWarning(sessionCode);
  const blockedReason =
    !camera
      ? "Choose a camera first"
      : !outputDir
        ? "Choose where to save first"
        : !plan?.mode
          ? "This camera cannot record at these settings"
          : audioEnabled && !microphone
            ? "Choose a microphone, or turn audio off"
            : estimate && !estimate.fits
              ? "Not enough free space"
              : codeWarning
                ? "Fix the session code first"
                : null;

  // ---- render -------------------------------------------------------------

  if (discreetActive && phase === "recording") {
    return <DiscreetOverlay message="Please wait for the researcher." />;
  }

  const recordingSettings = recovered?.settings ?? settings;
  if (phase === "recording" && recordingSettings) {
    return (
      <RecordScreen
        settings={recordingSettings}
        progress={progress}
        audioLevel={audioLevel}
        elapsedMs={elapsedMs}
        warnings={warnings}
        outputPath={outputPath}
        stopping={stopping}
        autoStopMinutes={autoStopMinutes}
        onStop={handleStop}
        onHide={discreet ? () => setDiscreetActive(true) : undefined}
      />
    );
  }

  if ((phase === "finishing" || phase === "done") && outcome) {
    return (
      <FinishScreen
        outcome={outcome}
        result={result}
        archive={archiveReport}
        finalizing={phase === "finishing"}
        error={error}
        onReveal={async () => {
          if (!result) return;
          const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
          await revealItemInDir(result.path);
        }}
        onAnother={() => {
          setPhase("setup");
          setOutcome(null);
          setResult(null);
          setArchiveReport(null);
          setError(null);
          setProgress(null);
          setRecovered(null);
        }}
      />
    );
  }

  return (
    <SetupScreen
      deviceList={deviceList}
      videoFingerprint={videoFingerprint}
      audioFingerprint={audioFingerprint}
      audioEnabled={audioEnabled}
      capabilities={capabilities}
      plan={plan}
      presetId={presetId}
      width={width}
      height={height}
      fps={fps}
      outputDir={outputDir}
      sessionCode={sessionCode}
      sessionMinutes={sessionMinutes}
      discreet={discreet}
      estimate={estimate}
      disk={disk}
      audioLevel={audioLevel}
      previewLive={previewLive}
      ffmpegVersion={ffmpegVersion}
      profileHash={profileHash}
      blockedReason={blockedReason}
      error={error ?? codeWarning}
      busy={preflightRunning}
      preflightReport={preflightReport}
      preflightRunning={preflightRunning}
      onPreflight={handlePreflight}
      roundRobin={{
        configured: Boolean(
          machineSettings?.roundRobinUrl && machineSettings.roundRobinSecretConfigured
        ),
        sessions,
        loading: sessionsLoading,
        slotId,
        roomIndex,
        opened,
        error: rrError,
        pendingCount,
        onSlot: (id) => {
          setSlotId(id);
          setOpened(null);
        },
        onRoom: setRoomIndex,
        onRefresh: refreshSessions,
        onClear: () => setOpened(null),
        onFlush: () => {
          void api
            .rrFlush()
            .then((r) => {
              setRrError(r.errors[0] ?? null);
              refreshPending();
            })
            .catch((e) => setRrError(String(e)));
        },
      }}
      machineSettings={{
        value: machineSettings,
        saving: savingSettings,
        onSave: (update) => {
          setSavingSettings(true);
          void api
            .saveSettings(update)
            .then((s) => {
              setMachineSettings(s);
              if (s.roundRobinUrl && s.roundRobinSecretConfigured) refreshSessions();
            })
            .catch((e) => setError(String(e)))
            .finally(() => setSavingSettings(false));
        },
        onPickDriveFolder: async () => {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const picked = await open({ directory: true, multiple: false });
          if (typeof picked === "string") {
            setSavingSettings(true);
            void api
              .saveSettings({ researchDriveRoot: picked })
              .then(setMachineSettings)
              .catch((e) => setError(String(e)))
              .finally(() => setSavingSettings(false));
          }
        },
      }}
      onSelectVideo={setVideoFingerprint}
      onSelectAudio={setAudioFingerprint}
      onToggleAudio={setAudioEnabled}
      onSelectPreset={(id) => {
        setPresetId(id);
        // A preset expresses intent; the camera decides whether it is possible.
        // Applied only when this camera advertised the combination.
        const preset = presetById(id);
        const match = plan?.resolutions.find(
          (r) => r.width === preset.width && r.height === preset.height
        );
        if (match) {
          setWidth(preset.width);
          setHeight(preset.height);
          if (match.rates.includes(preset.fps)) setFps(preset.fps);
        }
      }}
      onSelectResolution={(w, h) => {
        setWidth(w);
        setHeight(h);
        const rates = plan?.resolutions.find((r) => r.width === w && r.height === h)?.rates;
        if (rates && !rates.includes(fps)) setFps(rates[rates.length - 1]);
      }}
      onSelectFps={setFps}
      onPickFolder={async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked === "string") setOutputDir(picked);
      }}
      onSessionCode={setSessionCode}
      onSessionMinutes={setSessionMinutes}
      onToggleDiscreet={setDiscreet}
      onRefreshDevices={refreshDevices}
      onRecord={handleRecord}
    />
  );
}
