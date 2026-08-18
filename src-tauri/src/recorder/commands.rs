// The Lab Recorder command surface — every #[tauri::command] of Record mode.
//
// Frame-rate-exact webcam capture for dyadic conversation studies. The reason
// this exists rather than the Windows Camera app is written up in the lab's own
// notes (notes/research/conversation-quality/11-Recording-Requirements.md): the
// consumer capture path produces variable frame rate, and the PPS empathic
// accuracy score aligns a 100 ms slider trace against video time. Uneven frame
// timing puts a slow drift straight into the dependent variable, invisibly.
//
// The Rust side owns every media operation. The recorder webview has no shell
// and no fs access (see capabilities/recorder.json) — it sends settings and
// receives events.
//
// This file was the standalone Lab Recorder's lib.rs. The builder moved to the
// suite's lib.rs/modes.rs; the modules moved to siblings in this directory.
// Two commands carry a recorder_ prefix because the PPS station owns commands
// of the same name with different signatures, and the station's names are
// frozen — its frontend must stay byte-identical with the standalone PPS app.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::capture::{RecorderState, SessionKind, StopOutcome};
use super::devices::{CameraCapabilities, Device};
use super::disk::{DiskInfo, SpaceEstimate};
use super::ffmpeg::RecordSettings;
use super::manifest::{DeviceRecord, RecordingManifest};
use super::probe::Verification;
use super::{archive, capture, devices, disk, ffmpeg, manifest, probe, roundrobin, settings};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceList {
    pub devices: Vec<Device>,
    /// Cameras the operating system knows about but FFmpeg cannot open. Almost
    /// always laptop-internal MIPI sensors behind the Windows Frame Server.
    /// Reported so the app can explain the situation instead of claiming there
    /// is no camera on a machine with a visibly working one.
    pub unreachable_cameras: Vec<String>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeResult {
    pub path: String,
    pub manifest_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub verification: Verification,
    /// Plain-language verdict for the finish screen.
    pub summary: String,
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_devices(app: tauri::AppHandle) -> Result<DeviceList, String> {
    let found = devices::list_devices(&app).await?;
    let unreachable = devices::os_camera_gap(&found);
    Ok(DeviceList {
        backend: ffmpeg::CaptureBackend::current().format_flag().to_string(),
        unreachable_cameras: unreachable,
        devices: found,
    })
}

#[tauri::command]
pub async fn probe_camera(app: tauri::AppHandle, token: String) -> Result<CameraCapabilities, String> {
    devices::probe_camera(&app, &token).await
}

#[tauri::command]
pub async fn ffmpeg_info(app: tauri::AppHandle) -> Result<String, String> {
    ffmpeg::ffmpeg_version(&app).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionOption {
    pub width: u32,
    pub height: u32,
    pub rates: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePlan {
    /// None when the camera never advertised this combination. The UI shows
    /// what it *can* do rather than letting the request through and finding out
    /// during a session.
    pub mode: Option<devices::VideoMode>,
    pub resolutions: Vec<ResolutionOption>,
    pub message: String,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub modes: Vec<devices::VideoMode>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub device_name: String,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
}

/// Decides which of the camera's advertised modes to capture with.
///
/// Kept in Rust rather than duplicated in the frontend so there is exactly one
/// implementation of the ranking rule — the rule that keeps a webcam off its
/// 5 fps uncompressed mode is not something to maintain in two languages.
#[tauri::command]
pub fn plan_capture(request: PlanRequest) -> CapturePlan {
    let profile = devices::match_profile(
        &request.device_name,
        request.vendor_id.as_deref(),
        request.product_id.as_deref(),
    );
    let preference = devices::format_preference(profile);
    let chosen = devices::select_mode(
        &request.modes,
        request.width,
        request.height,
        request.fps,
        preference,
    )
    .cloned();

    let resolutions: Vec<ResolutionOption> = devices::resolution_options(&request.modes)
        .into_iter()
        .map(|(width, height, rates)| ResolutionOption { width, height, rates })
        .collect();

    let message = match &chosen {
        Some(mode) if mode.compressed => format!(
            "Capturing {}x{} at {} fps using the camera's {} mode.",
            mode.width, mode.height, request.fps, mode.format
        ),
        Some(mode) if mode.format == "auto" => format!(
            "Capturing {}x{} at {} fps; the system picks the input format.",
            mode.width, mode.height, request.fps
        ),
        Some(mode) => format!(
            "Capturing {}x{} at {} fps using the uncompressed {} mode. That is what this camera offers here.",
            mode.width, mode.height, request.fps, mode.format
        ),
        None => {
            let best = devices::recommend_mode(&request.modes, preference);
            match best {
                Some((w, h, f)) => format!(
                    "This camera did not advertise {}x{} at {} fps. The best it offers is {w}x{h} at {f} fps.",
                    request.width, request.height, request.fps
                ),
                None => "This camera did not report any usable modes.".to_string(),
            }
        }
    };

    CapturePlan {
        mode: chosen,
        resolutions,
        message,
        profile: profile.map(|p| p.label.to_string()),
    }
}

/// The mode this camera should default to, with no preset applied.
#[tauri::command]
pub fn recommend_mode(request: PlanRequest) -> Option<ResolutionOption> {
    let profile = devices::match_profile(
        &request.device_name,
        request.vendor_id.as_deref(),
        request.product_id.as_deref(),
    );
    devices::recommend_mode(&request.modes, devices::format_preference(profile)).map(
        |(width, height, fps)| ResolutionOption {
            width,
            height,
            rates: vec![fps],
        },
    )
}

// ---------------------------------------------------------------------------
// Preview and capture
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_preview(app: tauri::AppHandle, settings: RecordSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || capture::start_preview(&app, settings))
        .await
        .map_err(|e| format!("preview task failed: {e}"))?
}

#[tauri::command]
pub async fn stop_preview(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || capture::stop_any(&app))
        .await
        .map_err(|e| format!("stop task failed: {e}"))?
}

/// Latest complete preview frame as raw JPEG bytes.
///
/// Returned raw rather than base64 because at 10 fps the encoding overhead is
/// pure waste, and torn frames are filtered in Rust so the webview never has to
/// deal with a half-written image.
#[tauri::command]
pub fn preview_frame(app: tauri::AppHandle) -> tauri::ipc::Response {
    tauri::ipc::Response::new(capture::read_preview_frame(&app).unwrap_or_default())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub settings: RecordSettings,
    /// Folder the operator chose. The file lands here.
    pub output_dir: String,
    /// Filename without extension. Codes only — never a name or an email.
    pub file_stem: String,
    /// Opaque frontend state, held for the length of the take and handed back
    /// by `active_recording` if the webview reloads. Rust never reads it.
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn start_recording(app: tauri::AppHandle, request: StartRequest) -> Result<String, String> {
    let dir = PathBuf::from(&request.output_dir);
    if !dir.is_dir() {
        return Err(format!(
            "The save folder does not exist: {}",
            dir.display()
        ));
    }

    // Under the crash-safe strategy FFmpeg writes Matroska and the MP4 appears
    // at finalize. A killed process leaves an MP4 with no moov atom, which is
    // effectively unrecoverable; the MKV survives and can be finished later.
    let extension = match request.settings.container {
        ffmpeg::ContainerStrategy::CrashSafeMkv => "mkv",
        ffmpeg::ContainerStrategy::DirectMp4 => "mp4",
    };
    let capture_path = dir.join(format!("{}.{extension}", request.file_stem));

    if capture_path.exists() {
        return Err(format!(
            "{} already exists. Change the session code rather than overwriting a take.",
            capture_path.display()
        ));
    }

    // Ask the machine which encoder it can actually sustain before committing
    // a session to it. Software x264 cannot hold 1080p30 in real time on an
    // ordinary laptop, and falling behind does not merely drop frames — it
    // produces a file shorter than the conversation, with every frame time
    // wrong. See the note above best_encoder.
    let mut settings = request.settings;
    settings.encoder = ffmpeg::best_encoder(&app).await;

    let path_for_task = capture_path.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        capture::start_recording(&handle, settings, path_for_task)
    })
    .await
    .map_err(|e| format!("record task failed: {e}"))??;

    if let Ok(mut slot) = app.state::<RecorderState>().record_context.lock() {
        *slot = request.context;
    }

    Ok(capture_path.to_string_lossy().to_string())
}

/// What the frontend needs to rebuild its recording screen after a webview
/// reload: the take is still running in this process even though every piece of
/// React state just evaporated. Returns None when nothing is being recorded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRecordingInfo {
    pub capture_path: String,
    pub started_at: String,
    pub elapsed_ms: u64,
    pub settings: RecordSettings,
    pub context: Option<serde_json::Value>,
}

#[tauri::command]
pub fn active_recording(state: tauri::State<'_, RecorderState>) -> Option<ActiveRecordingInfo> {
    let active = state.active.lock().ok()?;
    let session = active.as_ref()?;
    if session.kind != SessionKind::Record {
        return None;
    }
    Some(ActiveRecordingInfo {
        capture_path: session
            .capture_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        started_at: session.started_at.to_rfc3339(),
        elapsed_ms: session.started_instant.elapsed().as_millis() as u64,
        settings: session.settings.clone(),
        context: state.record_context.lock().ok().and_then(|c| c.clone()),
    })
}

#[tauri::command]
pub async fn stop_recording(app: tauri::AppHandle) -> Result<StopOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || capture::stop_recording(&app))
        .await
        .map_err(|e| format!("stop task failed: {e}"))?
}

#[tauri::command]
pub fn is_recording(state: tauri::State<'_, RecorderState>) -> bool {
    state
        .active
        .lock()
        .map(|slot| matches!(slot.as_ref().map(|s| s.kind), Some(SessionKind::Record)))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub ok: bool,
    pub checks: Vec<PreflightCheck>,
    pub achieved_fps: f64,
    pub frames_dropped: u64,
    pub encoder_speed: f64,
}

/// Records five seconds with the real settings, measures what came out, throws
/// it away.
///
/// The point is to find out *before* two participants are sitting in the room
/// that the camera cannot hold 60 fps on this machine, or that the microphone
/// is muted. Everything it reports is measured from an actual capture — none of
/// it is inferred from the settings.
#[tauri::command]
pub async fn preflight(
    app: tauri::AppHandle,
    settings: RecordSettings,
    duration_seconds: u64,
    output_dir: String,
) -> Result<PreflightReport, String> {
    {
        // The preview holds the camera; on Windows that alone would make this fail.
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || capture::stop_any(&handle))
            .await
            .map_err(|e| format!("could not stop the preview: {e}"))??;
    }

    let scratch = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&scratch).ok();
    let capture = scratch.join("preflight.mkv");
    let preview = scratch.join("preflight.jpg");
    let _ = std::fs::remove_file(&capture);

    let paths = ffmpeg::OutputPaths {
        capture: capture.to_string_lossy().to_string(),
        preview: preview.to_string_lossy().to_string(),
    };
    // Preflight has to measure the encoder the real take will use, or it
    // measures nothing worth knowing.
    let mut settings = settings;
    settings.encoder = ffmpeg::best_encoder(&app).await;
    let args = ffmpeg::build_preflight_args(ffmpeg::CaptureBackend::current(), &settings, 5, &paths);
    let (stdout, stderr) = ffmpeg::run_tool(&app, "ffmpeg", args).await?;

    // Replay the -progress stream to recover the final counters.
    let mut accumulator = capture::ProgressAccumulator::default();
    let mut last = capture::ProgressSnapshot::default();
    for line in stdout.lines() {
        if let Some(snapshot) = accumulator.push(line) {
            last = snapshot;
        }
    }

    let mut checks: Vec<PreflightCheck> = Vec::new();
    let opened = last.frames > 0 && capture.exists();
    checks.push(PreflightCheck {
        label: "Camera opens".into(),
        passed: opened,
        detail: if opened {
            format!("{} frames captured", last.frames)
        } else {
            let tail: Vec<&str> = stderr
                .lines()
                .filter(|l| capture::is_noteworthy(l))
                .rev()
                .take(2)
                .collect();
            if tail.is_empty() {
                "No frames arrived from the camera.".into()
            } else {
                tail.join(" | ")
            }
        },
    });

    let mut verification = None;
    if opened {
        verification = probe::verify(&app, &capture.to_string_lossy(), settings.fps)
            .await
            .ok();
    }

    // Frames over the requested five seconds, which is what "did it keep up?"
    // actually means for a camera.
    let achieved_fps = last.frames as f64 / 5.0;
    let rate_ok = last.dropped_frames == 0
        && (achieved_fps - f64::from(settings.fps)).abs() <= f64::from(settings.fps) * 0.05;
    checks.push(PreflightCheck {
        label: "Frame rate holds".into(),
        passed: rate_ok,
        detail: format!(
            "{achieved_fps:.1} fps delivered against {} requested, {} dropped",
            settings.fps, last.dropped_frames
        ),
    });

    let encoder_ok = last.speed >= 0.98;
    checks.push(PreflightCheck {
        label: "Encoder keeps up".into(),
        passed: encoder_ok,
        detail: if last.speed > 0.0 {
            format!("{:.2}x real time", last.speed)
        } else {
            "not measured".into()
        },
    });

    if settings.audio.is_some() {
        let audible = verification
            .as_ref()
            .map(|v| v.audio_present && v.audio_silent != Some(true))
            .unwrap_or(false);
        checks.push(PreflightCheck {
            label: "Microphone is live".into(),
            passed: audible,
            detail: match verification.as_ref().and_then(|v| v.mean_volume_dbfs) {
                Some(mean) if mean >= -60.0 => format!("{mean:.1} dBFS average"),
                Some(mean) => format!("{mean:.1} dBFS — effectively silent"),
                None => "No audio reached the file.".into(),
            },
        });
    }

    let available = disk::disk_for_path(Path::new(&output_dir))
        .map(|d| d.available_bytes)
        .unwrap_or(0);
    let space = disk::estimate(
        settings.estimated_bytes_per_second(ffmpeg::encoder_family(
            &ffmpeg::best_encoder(&app).await,
        )),
        duration_seconds,
        available,
    );
    checks.push(PreflightCheck {
        label: "Room on the drive".into(),
        passed: space.fits,
        detail: space.warning.clone().unwrap_or_else(|| {
            format!(
                "{} free, about {} needed",
                disk::human_bytes(available),
                space
                    .projected_bytes
                    .map(disk::human_bytes)
                    .unwrap_or_else(|| "an unpredictable amount".into())
            )
        }),
    });

    let _ = std::fs::remove_file(&capture);

    Ok(PreflightReport {
        ok: checks.iter().all(|c| c.passed),
        checks,
        achieved_fps,
        frames_dropped: last.dropped_frames,
        encoder_speed: last.speed,
    })
}

// ---------------------------------------------------------------------------
// Finalize: remux, verify, checksum, manifest
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeRequest {
    pub outcome: StopOutcome,
    pub settings: RecordSettings,
    pub device: DeviceRecord,
    pub session_code: Option<String>,
    pub notes: Option<String>,
    pub discreet_mode: bool,
    pub profile_name: Option<String>,
}

#[tauri::command]
pub async fn finalize_recording(
    app: tauri::AppHandle,
    request: FinalizeRequest,
) -> Result<FinalizeResult, String> {
    let capture_path = PathBuf::from(&request.outcome.capture_path);
    if !capture_path.exists() {
        return Err(format!(
            "The captured file is missing: {}. Nothing was written — check the FFmpeg log on the finish screen.",
            capture_path.display()
        ));
    }

    let final_path = capture_path.with_extension("mp4");

    // Lossless container swap. No re-encode, so this cannot alter a single
    // pixel or shift a single timestamp.
    if matches!(request.settings.container, ffmpeg::ContainerStrategy::CrashSafeMkv) {
        let args = ffmpeg::build_remux_args(
            &capture_path.to_string_lossy(),
            &final_path.to_string_lossy(),
            request.settings.fps,
        );
        let (_, stderr) = ffmpeg::run_tool(&app, "ffmpeg", args).await?;
        if !final_path.exists() {
            return Err(format!(
                "Converting to MP4 failed, but the raw capture is safe at {}. FFmpeg said: {}",
                capture_path.display(),
                stderr.lines().rev().take(5).collect::<Vec<_>>().join(" | ")
            ));
        }
    }

    let verification = probe::verify(
        &app,
        &final_path.to_string_lossy(),
        request.settings.fps,
    )
    .await?;

    let checksum_path = final_path.clone();
    let sha256 = tauri::async_runtime::spawn_blocking(move || manifest::file_sha256(&checksum_path))
        .await
        .map_err(|e| format!("checksum task failed: {e}"))??;

    let size_bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    let summary = manifest::quality_summary(
        &request.outcome.progress,
        request.settings.fps,
        &verification,
        request.outcome.wall_duration_ms,
    );

    let audio = request.settings.audio.clone();
    let record = RecordingManifest {
        recorder_version: env!("CARGO_PKG_VERSION").to_string(),
        ffmpeg_version: ffmpeg::ffmpeg_version(&app).await.unwrap_or_default(),
        machine: sysinfo::System::host_name().unwrap_or_else(|| "unknown".into()),
        os: sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.into()),
        profile_hash: manifest::profile_hash(&request.settings),
        profile_name: request.profile_name,
        device: request.device,
        capture: manifest::CaptureRecord {
            width: request.settings.width,
            height: request.settings.height,
            requested_fps: request.settings.fps,
            input_format: request.settings.input_format.clone(),
            // What actually ran, which is not what the preset asked for when
            // Rust resolved a hardware encoder for this machine.
            encoder: if request.outcome.encoder.is_empty() {
                request.settings.encoder.clone()
            } else {
                request.outcome.encoder.clone()
            },
            // The speed knob the hardware path actually used, not the one the
            // profile asked for — a receipt that reports a setting that did
            // not run is worse than no receipt.
            encoder_preset: match ffmpeg::encoder_family(
                if request.outcome.encoder.is_empty() {
                    &request.settings.encoder
                } else {
                    &request.outcome.encoder
                },
            ) {
                ffmpeg::EncoderFamily::Qsv => "slower".to_string(),
                ffmpeg::EncoderFamily::Nvenc => "p4".to_string(),
                ffmpeg::EncoderFamily::Amf => "balanced".to_string(),
                ffmpeg::EncoderFamily::X264 => request.settings.encoder_preset.clone(),
            },
            rate_control: request.settings.rate_control,
            gop_seconds: request.settings.gop_seconds,
            audio_codec: audio.as_ref().map(|_| "aac".to_string()),
            audio_bitrate_kbps: audio.as_ref().map(|a| a.bitrate_kbps),
            audio_sample_rate: audio.as_ref().map(|a| a.sample_rate),
            audio_channels: audio.as_ref().map(|a| a.channels),
        },
        file: final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        started_at: request.outcome.started_at.clone(),
        ended_at: request.outcome.ended_at.clone(),
        wall_duration_ms: request.outcome.wall_duration_ms,
        frames_written: request.outcome.progress.frames,
        frames_dropped: request.outcome.progress.dropped_frames,
        frames_duplicated: request.outcome.progress.duplicated_frames,
        achieved_fps: manifest::achieved_fps(
            &request.outcome.progress,
            request.outcome.wall_duration_ms,
        ),
        encoder_speed: request.outcome.progress.speed,
        size_bytes,
        sha256: sha256.clone(),
        verification: verification.clone(),
        discreet_mode: request.discreet_mode,
        session_code: request.session_code,
        notes: request.notes,
    };

    let manifest_path = final_path.with_extension("json");
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&record)
            .map_err(|e| format!("could not build the manifest: {e}"))?,
    )
    .map_err(|e| format!("could not write {}: {e}", manifest_path.display()))?;

    // Only now is the intermediate expendable: the MP4 exists, it verified, and
    // its checksum is recorded.
    if matches!(request.settings.container, ffmpeg::ContainerStrategy::CrashSafeMkv)
        && final_path.exists()
    {
        let _ = std::fs::remove_file(&capture_path);
    }

    Ok(FinalizeResult {
        path: final_path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        size_bytes,
        sha256,
        verification,
        summary,
    })
}

/// Captures left behind by a crash: an .mkv with no matching .mp4 beside it.
#[tauri::command]
pub fn find_orphaned_captures(dir: String) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("mkv"))
        .filter(|p| !p.with_extension("mp4").exists())
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Settings, Research Drive, Round Robin
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn recorder_load_settings(app: tauri::AppHandle) -> settings::PublicSettings {
    let mut public = settings::compose_public(&settings::load(&app), &crate::machine::load(&app));
    // Report the address and folder this machine will actually use, not the
    // raw stored values. Both now have defaults, and a frontend that sees an
    // empty URL concludes it is unconfigured and never asks the server for
    // the session list — which silently costs every take its Round Robin
    // link.
    public.round_robin_url = Some(crate::machine::server_url(&app));
    public.research_drive_root = crate::machine::drive_root(&app);
    public
}

#[tauri::command]
pub fn recorder_save_settings(
    app: tauri::AppHandle,
    update: settings::SettingsUpdate,
) -> Result<settings::PublicSettings, String> {
    // The wire format still carries the shared trio (URL / secret / drive
    // root) so the recorder settings panel keeps working unchanged — but
    // those fields are machine-wide and write through to machine.json, the
    // one store every mode reads.
    if update.touches_machine() {
        let machine_update = crate::machine::MachineUpdate {
            round_robin_url: update.round_robin_url.clone(),
            round_robin_secret: update.round_robin_secret.clone(),
            research_drive_root: update.research_drive_root.clone(),
        };
        let merged = crate::machine::merge_update(&crate::machine::load(&app), machine_update);
        crate::machine::save(&app, &merged)?;
    }
    let merged = settings::merge_update(&settings::load(&app), &update);
    settings::save(&app, &merged)?;
    Ok(settings::compose_public(&merged, &crate::machine::load(&app)))
}

/// Base URL plus secret, or a message explaining what is missing. Reads the
/// machine-wide store — the same credentials every mode uses.
pub fn round_robin_credentials(app: &tauri::AppHandle) -> Result<(String, String), String> {
    crate::machine::credentials(app)
}

#[tauri::command]
pub async fn rr_sessions(app: tauri::AppHandle) -> Result<Vec<roundrobin::SessionSummary>, String> {
    let (url, secret) = round_robin_credentials(&app)?;
    roundrobin::list_sessions(&url, &secret).await
}

#[tauri::command]
pub async fn rr_open(
    app: tauri::AppHandle,
    slot_id: String,
    room_index: i32,
    round: Option<i32>,
    force: bool,
) -> Result<roundrobin::OpenedRecording, String> {
    let (url, secret) = round_robin_credentials(&app)?;
    roundrobin::open_recording(&url, &secret, &slot_id, room_index, round, force).await
}

#[tauri::command]
pub fn rr_pending(app: tauri::AppHandle) -> Vec<roundrobin::PendingRegistration> {
    roundrobin::load_queue(&app)
}

#[tauri::command]
pub async fn rr_flush(app: tauri::AppHandle) -> Result<roundrobin::FlushReport, String> {
    let (url, secret) = round_robin_credentials(&app)?;
    roundrobin::flush(&app, &url, &secret).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRequest {
    pub local_path: String,
    pub sha256: String,
    /// Present only when the take was opened against Round Robin beforehand.
    pub recording_id: Option<String>,
    pub storage_key: Option<String>,
    pub payload: roundrobin::ClosePayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReport {
    pub archived: Option<archive::ArchiveOutcome>,
    pub registered: bool,
    pub queued: bool,
    pub message: String,
}

/// Copies the finished recording to the Research Drive and closes its Round
/// Robin row.
///
/// Every failure path here ends with the local file untouched and, where there
/// is something to retry, an entry in the offline queue. Losing the network
/// after a conversation has been recorded is an inconvenience; it must never
/// become a lost recording.
#[tauri::command]
pub async fn archive_recording(
    app: tauri::AppHandle,
    request: ArchiveRequest,
) -> Result<ArchiveReport, String> {
    // The version stamped into the database is the version that actually ran,
    // not whatever the webview believed it was running.
    let mut request = request;
    request.payload.recorder_version = env!("CARGO_PKG_VERSION").to_string();

    let (Some(recording_id), Some(storage_key)) =
        (request.recording_id.clone(), request.storage_key.clone())
    else {
        return Ok(ArchiveReport {
            archived: None,
            registered: false,
            queued: false,
            message: "This take was not linked to a Round Robin session, so it stays local only."
                .into(),
        });
    };

    let queue_entry = |archived: bool, error: &str| roundrobin::PendingRegistration {
        recording_id: recording_id.clone(),
        storage_key: storage_key.clone(),
        local_path: request.local_path.clone(),
        archived,
        payload: request.payload.clone(),
        attempts: 1,
        last_error: Some(error.to_string()),
        queued_at: chrono::Utc::now().to_rfc3339(),
    };

    let drive_root = crate::machine::drive_root(&app);
    let Some(drive_root) = drive_root else {
        let message =
            "No Research Drive folder is configured, so the recording stays on this computer."
                .to_string();
        roundrobin::enqueue(&app, queue_entry(false, &message))?;
        return Ok(ArchiveReport {
            archived: None,
            registered: false,
            queued: true,
            message,
        });
    };

    // Copy on a blocking thread: a 900 MB file over SMB would otherwise stall
    // the async runtime for the whole transfer.
    let source = PathBuf::from(&request.local_path);
    let expected = request.sha256.clone();
    let key = storage_key.clone();
    let copy = tauri::async_runtime::spawn_blocking(move || {
        let destination = archive::resolve_storage_path(Path::new(&drive_root), &key)?;
        archive::copy_verified(&source, &destination, &expected)
    })
    .await
    .map_err(|e| format!("copy task failed: {e}"))?;

    let outcome = match copy {
        Ok(outcome) => outcome,
        Err(e) => {
            roundrobin::enqueue(&app, queue_entry(false, &e))?;
            return Ok(ArchiveReport {
                archived: None,
                registered: false,
                queued: true,
                message: format!("{e} The recording is safe on this computer and will be retried."),
            });
        }
    };

    let (url, secret) = match round_robin_credentials(&app) {
        Ok(pair) => pair,
        Err(e) => {
            roundrobin::enqueue(&app, queue_entry(true, &e))?;
            return Ok(ArchiveReport {
                archived: Some(outcome),
                registered: false,
                queued: true,
                message: format!("Copied to the Research Drive, but {e}"),
            });
        }
    };

    match roundrobin::close_recording(&url, &secret, &recording_id, &request.payload).await {
        Ok(()) => Ok(ArchiveReport {
            archived: Some(outcome),
            registered: true,
            queued: false,
            message: "Copied to the Research Drive and registered with Round Robin.".into(),
        }),
        Err(e) => {
            roundrobin::enqueue(&app, queue_entry(true, &e))?;
            Ok(ArchiveReport {
                archived: Some(outcome),
                registered: false,
                queued: true,
                message: format!("Copied to the Research Drive, but {e} It will be retried."),
            })
        }
    }
}

/// Releases a Round Robin row whose take never produced a usable file.
///
/// Opening the row happens before the take, so a take that dies leaves it
/// sitting `in_progress`. Nothing closed it, and the open guard then refused
/// every later take for that room — the recordings kept working and kept
/// coming back unlinked, which is invisible until a participant sits down at
/// a rating station and their conversation cannot be found.
///
/// Closing with nothing to report is exactly right: the server marks a
/// zero-byte take `failed`, the room frees up immediately, and the failure
/// stays visible on the Control Center's coverage matrix instead of being
/// quietly erased. (2026-08-18)
#[tauri::command]
pub async fn rr_abandon(app: tauri::AppHandle, recording_id: String) -> Result<(), String> {
    let (url, secret) = round_robin_credentials(&app)?;
    roundrobin::close_recording(
        &url,
        &secret,
        &recording_id,
        &roundrobin::ClosePayload {
            duration_ms: 0,
            capture_fps: 0,
            frames_dropped: 0,
            frames_duplicated: 0,
            sha256: String::new(),
            profile_hash: String::new(),
            recorder_version: String::new(),
            cfr: false,
            bytes: 0,
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn disk_space(path: String) -> Option<DiskInfo> {
    disk::disk_for_path(Path::new(&path))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateRequest {
    pub settings: RecordSettings,
    pub duration_seconds: u64,
    pub path: String,
}

#[tauri::command]
pub async fn estimate_space(
    app: tauri::AppHandle,
    request: EstimateRequest,
) -> SpaceEstimate {
    let available = disk::disk_for_path(Path::new(&request.path))
        .map(|d| d.available_bytes)
        .unwrap_or(0);
    // The encoder decides the real file size, so the forecast has to ask which
    // one will run. Probed once per process and cached thereafter, so the
    // per-keystroke recompute costs nothing after the first.
    let family = ffmpeg::encoder_family(&ffmpeg::best_encoder(&app).await);
    disk::estimate(
        request.settings.estimated_bytes_per_second(family),
        request.duration_seconds,
        available,
    )
}

#[tauri::command]
pub fn profile_hash(settings: RecordSettings) -> String {
    manifest::profile_hash(&settings)
}

