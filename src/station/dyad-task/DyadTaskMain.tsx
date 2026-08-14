import { useState, useEffect, useRef, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ConversationPrep, FormData } from "../App";
import { describeClip } from "../remote/api";
import type { RemoteClip } from "../remote/api";
import { csvEscape } from "../utils/csv";
import { registerFlush } from "../utils/flushRegistry";

import VideoPlayer from "./VideoPlayer";
import Slider from "./Slider";
import Instructions from "./Instructions";
import RatingOverlay from "./RatingOverlay";
import TransitionScreen from "./TransitionScreen";

const SOFTWARE_VERSION = "2.0.0";

const DYAD_BLOCKS = 4;

// The instruction screens, revealed one keypress at a time. groupSize below is
// this array's length so all five build up on a single page instead of
// splitting 4 + 1, and the keydown handler advances off the same count.
const DYAD_INSTRUCTIONS = [
  "In this part of the study, you will watch the video recording of the conversation you just had.",
  "We are interested in two things:\n\t1. How YOU were feeling during the conversation.\n\t2. How YOUR PARTNER was feeling during the conversation.",
  "The video is split into parts. Before each part, the screen will tell you whether to focus on YOUR OWN feelings or YOUR PARTNER'S feelings, and a reminder stays in the corner of the screen while you watch.",
  "As the video plays, continuously move the slider to indicate how positive or negative YOU or YOUR PARTNER felt at that moment during the conversation.",
  "At certain points, you will be asked to write a short response and make ratings about how you or your partner felt during the part of the conversation you just watched.",
];

interface DyadTaskMainProps {
  formData: FormData;
  csvFilePath: string;
  taskOrder: number;
  /**
   * The automatic conversation-video fetch, driven from App. When it lands in
   * "ready" the video is loaded without anyone touching a file picker; every
   * other state renders around the manual picker so the pipeline can never
   * block a session.
   */
  conversation?: {
    prep: ConversationPrep;
    onUseClip: (clip: RemoteClip) => void;
    onRetry: () => void;
  };
  onComplete?: () => void;
  onCsvError?: (msg: string) => void;
  /** Reports block progress for the researcher dashboard. */
  onProgress?: (done: number, total: number, detail: string) => void;
  /**
   * True while the continuous rating is running. The slider reads raw mouse X,
   * so anything that tempts the participant to move the pointer off the trace
   * (the help button, for one) has to be hidden while this is set — a stray
   * move to a corner is recorded as a real rating.
   */
  onCursorLock?: (locked: boolean) => void;
}

function DyadTaskMain({
  formData,
  csvFilePath,
  taskOrder,
  conversation,
  onComplete,
  onCsvError,
  onProgress,
  onCursorLock,
}: DyadTaskMainProps) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [showVideoInput, setShowVideoInput] = useState(true);
  const [showToggleScreen, setShowToggleScreen] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [numberScale, setNumberScale] = useState<number | undefined>(undefined);
  const [currentRatingTarget, setCurrentRatingTarget] = useState<"self" | "partner">("self");
  const [instructionsDone, setInstructionsDone] = useState(false);
  const [instructionIndex, setInstructionIndex] = useState(0);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  // Not state: the slider is sampled 10×/s and nothing renders from the latest
  // value, so keeping it in state re-rendered the whole task on every sample.
  const latestSliderRef = useRef<number>(50);
  const [videoEnded, setVideoEnded] = useState(false);
  const [showTransitionScreen, setShowTransitionScreen] = useState(false);
  /**
   * True once the video has run out and the last writing + rating screen is
   * being collected.
   *
   * Randy, 2026-07-30: a video shorter than the block length used to end the
   * task outright, with no writing screen and no ratings — so a short test clip
   * showed none of the directions. The writing screen and the Likert are now
   * always collected at the end, whatever the video's length.
   */
  const [awaitingFinalRating, setAwaitingFinalRating] = useState(false);

  const overlayWatchRef = useRef<number | null>(null);
  const sliderFlushRef = useRef<number | null>(null);
  const taskStartMsRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nextStopTimeSecRef = useRef<number>(150);
  const sampleBufferRef = useRef<string[]>([]);
  const videoStartedRef = useRef<boolean>(false);
  const textPromptCountRef = useRef<number>(0);
  const trialNumber = useRef<number>(1);
  // One diagnostic per mount for samples skipped while the video clock reads 0
  // — expected for a beat after each overlay while play() spins up, but a
  // video that never starts should leave a trace in the console.
  const zeroVtLoggedRef = useRef<boolean>(false);
  // A rejected video.play() (autoplay policy, decoder failure) shown to the
  // participant — same fail-loudly reasoning as StimulusPlayer's loadError.
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  // Fire-once guard: prevents onComplete from being called multiple times.
  const completedRef = useRef<boolean>(false);
  // End-of-video is reported by three independent detectors (the `ended` event,
  // a timeupdate threshold, and a polling fallback). This makes the first one
  // that fires the only one that does anything.
  const videoFinishedRef = useRef<boolean>(false);
  const awaitingFinalRatingRef = useRef<boolean>(false);

  // Mirrors the cursor-none condition used on the wrapper below: the pointer is
  // the measurement while the video plays with no overlay on top of it.
  const cursorLocked = Boolean(
    videoSrc && !showToggleScreen && !showTransitionScreen && instructionsDone && !videoEnded
  );
  useEffect(() => {
    onCursorLock?.(cursorLocked);
    return () => onCursorLock?.(false);
  }, [cursorLocked, onCursorLock]);

  const handleCsvError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("CSV write failed:", msg);
      onCsvError?.(`Write failed: ${msg}`);
    },
    [onCsvError]
  );

  const callOnComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  /** Writes anything still sitting in the 15-second sample buffer. */
  const flushSamples = useCallback(() => {
    const buffer = sampleBufferRef.current;
    if (buffer.length === 0) return;
    // Drain, but keep a handle on what was drained: if the write rejects, the
    // rows go back to the FRONT of the buffer (order preserved) for the next
    // flush, instead of being gone. The Rust side appends line-by-line, so a
    // partial write followed by a retry can duplicate the rows that did land —
    // duplicates are recoverable in analysis, silently lost samples are not.
    const drained = buffer.splice(0, buffer.length);
    invoke("write_csv_ratings", {
      path: csvFilePath,
      contents: drained,
    }).catch((err) => {
      sampleBufferRef.current.unshift(...drained);
      handleCsvError(err);
    });
  }, [csvFilePath, handleCsvError]);

  /** Stops the video and the sampler, and writes whatever is still buffered. */
  const stopPlayback = useCallback(() => {
    videoFinishedRef.current = true;
    videoRef.current?.pause();
    setVideoEnded(true);
    flushSamples();
  }, [flushSamples]);

  /** Everything is collected — hand back to the app. */
  const finishTask = useCallback(() => {
    stopPlayback();
    awaitingFinalRatingRef.current = false;
    setAwaitingFinalRating(false);
    setShowToggleScreen(false);
    callOnComplete();
  }, [stopPlayback, callOnComplete]);

  /**
   * The video ran out. Stop, then collect the final writing + rating screen
   * before finishing — the task never ends without it.
   */
  const handleVideoFinished = useCallback(() => {
    if (videoFinishedRef.current) return;
    stopPlayback();
    awaitingFinalRatingRef.current = true;
    setAwaitingFinalRating(true);
    setAttemptedSubmit(false);
    setShowToggleScreen(true);
  }, [stopPlayback]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.type === "video/mp4" || file.type === "video/quicktime")) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setShowVideoInput(false);
      setCurrentRatingTarget(formData.computer === "Left" ? "self" : "partner");
    } else {
      alert("Please select a valid MP4 or MOV video file.");
    }
  };

  // When the RA prefers the manual picker even though the automatic fetch is
  // available (or still running). Session-local; never persisted.
  const [manualMode, setManualMode] = useState(false);

  // The automatic path into the task: the fetched, checksum-verified local
  // copy loads exactly the way a hand-picked file would — same seat rule for
  // the first perspective, same <video> element, same everything after this
  // point. The pipeline changes how the file arrives, not how it plays.
  const consumedPathRef = useRef<string | null>(null);
  const prep = conversation?.prep;
  useEffect(() => {
    if (!prep || prep.status !== "ready" || !showVideoInput || manualMode) return;
    if (consumedPathRef.current === prep.localPath) return;
    consumedPathRef.current = prep.localPath;
    setVideoSrc(convertFileSrc(prep.localPath));
    setShowVideoInput(false);
    setCurrentRatingTarget(formData.computer === "Left" ? "self" : "partner");
  }, [prep, showVideoInput, manualMode, formData.computer]);

  // The object URL keeps the whole conversation recording mapped for the life
  // of the URL, not the life of the element — release it when the source
  // changes or the task unmounts.
  useEffect(() => {
    if (!videoSrc) return;
    return () => URL.revokeObjectURL(videoSrc);
  }, [videoSrc]);

  const buildRow = (
    sliderVal: number,
    emoRating: number | string,
    elapsedSec: number,
    movieTime: number,
    isShift: 0 | 1,
    description: string
  ): string =>
    [
      formData.participantId,
      formData.partnerId,
      formData.dyadId,
      formData.computer,
      formData.subjectInitials,
      formData.raName,
      formData.sessionTime,
      formData.sessionDate,
      new Date().toISOString(),
      taskOrder.toString(),
      sliderVal.toFixed(2),
      emoRating,
      currentRatingTarget,
      elapsedSec.toFixed(2),
      nextStopTimeSecRef.current.toFixed(0),
      movieTime.toFixed(2),
      isShift,
      description,
      trialNumber.current,
      SOFTWARE_VERSION,
    ]
      .map(csvEscape)
      .join(",");

  // Main sampling + overlay-watch loop.
  //
  // The sampler is a drift-correcting setTimeout chain, not a setInterval:
  // every tick is scheduled against the loop's own start on the
  // performance.now() clock (deadline = start + n × 100 ms), so a tick that
  // fires late (GC pause, decoder stall) does not push every later sample
  // late with it. The 100 ms cadence is the measurement, not UI.
  useEffect(() => {
    let sampleTimerIdLocal: number | null = null;
    let sampleLoopCancelled = false;
    if (videoSrc && instructionsDone && !showTransitionScreen) {
      if (taskStartMsRef.current === null) {
        taskStartMsRef.current = Date.now();
      }

      const SAMPLE_INTERVAL_MS = 100;
      const loopStartMs = performance.now();
      let tickCount = 0;

      const takeSample = () => {
        if (sampleLoopCancelled) return;
        if (!showToggleScreen && !videoEnded && !showTransitionScreen) {
          const vt = videoRef.current?.currentTime ?? 0;
          if (vt <= 0) {
            // Expected for a beat while play() spins up after an overlay, but
            // logged once so a video that never starts leaves a trace.
            if (!zeroVtLoggedRef.current) {
              zeroVtLoggedRef.current = true;
              console.error(
                "Dyad sampler: skipping samples while video currentTime is 0 (video not yet playing)."
              );
            }
          } else {
            if (!videoStartedRef.current) {
              videoStartedRef.current = true;
              nextStopTimeSecRef.current = Math.ceil(vt / 150) * 150 || 150;
            }
            const elapsed = taskStartMsRef.current
              ? (Date.now() - taskStartMsRef.current) / 1000
              : 0;
            const row = buildRow(latestSliderRef.current, "NA", elapsed, vt, 0, "");
            sampleBufferRef.current.push(row);
          }
        }
        tickCount += 1;
        const nextDeadline = loopStartMs + tickCount * SAMPLE_INTERVAL_MS;
        sampleTimerIdLocal = window.setTimeout(
          takeSample,
          Math.max(0, nextDeadline - performance.now())
        );
      };

      sampleTimerIdLocal = window.setTimeout(takeSample, SAMPLE_INTERVAL_MS);

      overlayWatchRef.current = window.setInterval(() => {
        if (
          !showToggleScreen &&
          !videoEnded &&
          !showTransitionScreen &&
          videoRef.current &&
          videoStartedRef.current
        ) {
          if (videoRef.current.currentTime >= nextStopTimeSecRef.current) {
            setShowToggleScreen(true);
            setAttemptedSubmit(false);
          }
        }
      }, 50);

      sliderFlushRef.current = window.setInterval(flushSamples, 15000);
    }

    return () => {
      sampleLoopCancelled = true;
      if (sampleTimerIdLocal !== null) clearTimeout(sampleTimerIdLocal);
      if (overlayWatchRef.current) clearInterval(overlayWatchRef.current);
      if (sliderFlushRef.current) clearInterval(sliderFlushRef.current);
    };
  }, [videoSrc, instructionsDone, showToggleScreen, showTransitionScreen]);

  // Polling end-of-video detection (fallback for webviews that swallow `ended`).
  useEffect(() => {
    if (!videoSrc || videoEnded) return;
    const interval = setInterval(() => {
      const el = videoRef.current;
      if (el && el.duration && el.currentTime >= el.duration - 0.1) {
        handleVideoFinished();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [videoSrc, videoEnded, handleVideoFinished]);

  // Event-based end-of-video detection.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    const handleTimeUpdate = () => {
      if (el.duration && el.currentTime >= el.duration - 0.5) handleVideoFinished();
    };

    el.addEventListener("ended", handleVideoFinished);
    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      el.removeEventListener("ended", handleVideoFinished);
      el.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [videoSrc, handleVideoFinished]);

  // Register a flush so the researcher save-and-quit path writes any buffered
  // slider samples to disk before the app exits (the sampler only auto-flushes
  // every 15 s, so up to ~15 s of samples live only in memory at any moment).
  useEffect(() => {
    const unregister = registerFlush(async () => {
      const buffer = sampleBufferRef.current;
      if (buffer.length > 0) {
        const toFlush = buffer.splice(0, buffer.length);
        try {
          await invoke("write_csv_ratings", { path: csvFilePath, contents: toFlush });
        } catch (err) {
          // Same recovery as flushSamples: a failed write must not cost the
          // rows. Put them back at the front and let the caller see the error.
          sampleBufferRef.current.unshift(...toFlush);
          throw err;
        }
      }
    });
    return unregister;
  }, [csvFilePath]);

  // Play/pause based on overlay state. Never restarts a video that has already
  // run out — closing the final writing screen must not replay the last frame.
  //
  // Playback starts HERE, not from an autoPlay attribute on the element:
  // autoplay started the video (audio included) underneath the 6-second
  // perspective announcement while the sampler was gated off, so the opening
  // of each first segment played unwatched and unrated behind an opaque
  // overlay. Starting from this effect means nothing plays until every overlay
  // is cleared and the participant can see and rate it. The explicit .catch
  // follows StimulusPlayer: a rejected play() (autoplay policy, decoder
  // failure) must fail loudly, not look like a frozen app.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (showToggleScreen || showTransitionScreen || videoEnded) {
      video.pause();
    } else if (instructionsDone) {
      video.play().then(
        () => setPlaybackError(null),
        (err) => {
          console.error("Dyad video playback failed:", err);
          setPlaybackError("The video could not be started. Please alert your researcher.");
        }
      );
    }
  }, [showToggleScreen, showTransitionScreen, instructionsDone, videoEnded]);

  const submitAndAdvance = async (ratingValue: number | string, note: string) => {
    try {
      const elapsed = taskStartMsRef.current
        ? (Date.now() - taskStartMsRef.current) / 1000
        : 0;
      const movieTime = videoRef.current?.currentTime ?? 0;

      const row = buildRow(latestSliderRef.current, ratingValue, elapsed, movieTime, 1, note);
      await invoke("write_csv_ratings", { path: csvFilePath, contents: [row] });

      textPromptCountRef.current += 1;
      trialNumber.current += 1;
      setTextInput("");
      setNumberScale(undefined);
      setAttemptedSubmit(false);
      setShowToggleScreen(false);
      onProgress?.(
        textPromptCountRef.current,
        DYAD_BLOCKS,
        `Block ${Math.min(textPromptCountRef.current + 1, DYAD_BLOCKS)} of ${DYAD_BLOCKS}`
      );

      // This was the writing screen that follows the end of the video, or the
      // last of the four blocks — either way the task is over.
      if (awaitingFinalRatingRef.current || textPromptCountRef.current >= DYAD_BLOCKS) {
        finishTask();
        return;
      }

      setCurrentRatingTarget((prev) => (prev === "self" ? "partner" : "self"));
      setResetTrigger((prev) => prev + 1);
      nextStopTimeSecRef.current += 150;
      // Show the between-block transition prompt.
      setShowTransitionScreen(true);
    } catch (err) {
      handleCsvError(err);
    }
  };

  const handleTabSubmit = async () => {
    if (!showToggleScreen) return;
    if (textInput.trim() === "" && numberScale === undefined) {
      setAttemptedSubmit(true);
      return;
    }
    if (numberScale !== undefined) {
      await submitAndAdvance(numberScale, textInput);
    } else {
      setAttemptedSubmit(true);
    }
  };

  const handleConfirmIncomplete = async () => {
    if (!showToggleScreen) return;
    // A skipped elicitation rating is written as "" — the same convention the
    // video task uses for skipped sliders (see VideoRatingPage). The old 0
    // was indistinguishable from a low answer on the 1-9 scale.
    await submitAndAdvance(numberScale ?? "", textInput.trim());
  };

  const handleDismissIncomplete = () => setAttemptedSubmit(false);

  // Stable identity: Slider calls this from its mousemove listener (one ref
  // write per event), and that listener must not be torn down and re-attached
  // because this component re-rendered.
  const handleSliderSample = useCallback((value: number) => {
    latestSliderRef.current = value;
  }, []);

  const handleTransitionContinue = () => setShowTransitionScreen(false);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // The perspective announcement holds itself open for a few seconds and
      // owns its own key handling — see TransitionScreen. Advancing it from
      // here as well would let a keypress skip straight past it.
      if (showTransitionScreen) {
        event.preventDefault();
      } else if (showToggleScreen && event.key === "Tab") {
        event.preventDefault();
        handleTabSubmit();
      } else if (videoSrc && !instructionsDone) {
        // Auto-repeat from a held key and lone modifiers are not deliberate
        // keypresses — either could blow through several instruction screens.
        if (event.repeat || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        event.preventDefault();
        if (instructionIndex + 1 >= DYAD_INSTRUCTIONS.length) {
          setInstructionsDone(true);
          setShowTransitionScreen(true);
        } else {
          setInstructionIndex((i) => i + 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    showTransitionScreen,
    showToggleScreen,
    textInput,
    numberScale,
    videoSrc,
    instructionsDone,
    instructionIndex,
  ]);

  return (
    <div
      className={`h-screen w-screen overflow-hidden bg-black ${
        videoSrc && !showToggleScreen && instructionsDone ? "cursor-none" : "cursor-auto"
      }`}
    >
      {showVideoInput ? (
        <div className="h-full w-full flex items-center justify-center bg-black">
          <div className="bg-black border p-8 max-w-2xl mx-auto">
            {!manualMode && prep && prep.status === "finding" ? (
              <>
                <h1 className="text-white text-2xl mb-4">Finding the conversation video…</h1>
                <p className="text-gray-400 mb-8">
                  Asking Round Robin which recording belongs to this participant.
                </p>
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="text-gray-400 underline hover:text-white"
                >
                  Choose a file manually instead
                </button>
              </>
            ) : !manualMode && prep && prep.status === "copying" ? (
              <>
                <h1 className="text-white text-2xl mb-4">Preparing the conversation video…</h1>
                <p className="text-gray-400 mb-2">{describeClip(prep.clip)}</p>
                <p className="text-gray-400 mb-4">
                  Copying from the Research Drive and verifying the recorder&rsquo;s
                  checksum. This can take a minute for a full conversation.
                </p>
                <div className="w-full h-3 border border-white mb-2">
                  <div
                    className="h-full bg-white transition-all"
                    style={{
                      width:
                        prep.totalBytes > 0
                          ? `${Math.min(100, (prep.copiedBytes / prep.totalBytes) * 100).toFixed(1)}%`
                          : "5%",
                    }}
                  />
                </div>
                <p className="text-gray-400 text-sm mb-8">
                  {prep.totalBytes > 0
                    ? `${Math.round(prep.copiedBytes / 1048576)} MB of ${Math.round(prep.totalBytes / 1048576)} MB`
                    : "Starting…"}
                </p>
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="text-gray-400 underline hover:text-white"
                >
                  Choose a file manually instead
                </button>
              </>
            ) : !manualMode && prep && prep.status === "choose" ? (
              <>
                <h1 className="text-white text-2xl mb-4">
                  Which conversation should be rated?
                </h1>
                <p className="text-gray-400 mb-6">
                  This participant has {prep.clips.length} recordings on file. The most
                  recent is first.
                </p>
                <div className="space-y-3 mb-8">
                  {[
                    prep.recommended,
                    ...prep.clips.filter(
                      (c) => c.recordingId !== prep.recommended.recordingId
                    ),
                  ].map((clip) => (
                    <button
                      key={clip.recordingId}
                      type="button"
                      onClick={() => conversation?.onUseClip(clip)}
                      className={`block w-full border p-4 text-left text-white hover:bg-gray-800 ${
                        clip.recordingId === prep.recommended.recordingId
                          ? "border-white"
                          : "border-gray-600"
                      }`}
                    >
                      {describeClip(clip)}
                      {clip.recordingId === prep.recommended.recordingId && (
                        <span className="ml-2 text-gray-400 text-sm">(most recent)</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="text-gray-400 underline hover:text-white"
                >
                  Choose a file manually instead
                </button>
              </>
            ) : !manualMode && prep && prep.status === "ready" ? (
              <h1 className="text-white text-2xl">Loading the conversation video…</h1>
            ) : (
              <>
                {!manualMode && prep && prep.status === "failed" && (
                  <div className="mb-6 border border-red-400 bg-red-900/40 p-4">
                    <p className="text-white mb-3">
                      The conversation video could not be fetched automatically.
                    </p>
                    <p className="text-red-200 text-sm mb-3">{prep.message}</p>
                    <button
                      type="button"
                      onClick={() => conversation?.onRetry()}
                      className="px-4 py-2 border border-white text-white hover:bg-gray-800"
                    >
                      Try again
                    </button>
                  </div>
                )}
                <h1 className="text-white text-2xl mb-8">Select Video File</h1>
                <input
                  type="file"
                  accept=".mp4,.mov"
                  onChange={handleFileChange}
                  className="px-4 py-2 border rounded-2xl border-white bg-black text-white cursor-pointer hover:bg-gray-800"
                />
              </>
            )}
          </div>
        </div>
      ) : videoSrc && !instructionsDone ? (
        <Instructions
          instructionIndex={instructionIndex}
          onBack={() => setInstructionIndex((i) => Math.max(0, i - 1))}
          groupSize={DYAD_INSTRUCTIONS.length}
          instructions={DYAD_INSTRUCTIONS}
        />
      ) : (
        <div className="h-full w-full flex flex-col relative">
          {playbackError && (
            <div className="absolute top-0 left-0 right-0 z-30 bg-red-700 border-b-2 border-red-400 px-6 py-3 text-center">
              <p className="text-white font-bold text-lg">{playbackError}</p>
            </div>
          )}
          {/* Perspective reminder, on screen for the whole block. Randy,
              2026-07-30: participants were losing track of whose feelings they
              were rating, and by the middle of the task were no longer
              re-reading the prompt at all. */}
          {!showToggleScreen && !showTransitionScreen && (
            <div className="absolute top-6 right-8 z-20 border-2 border-white bg-black px-5 py-2.5 text-center">
              <span className="block text-gray-400 text-xs uppercase tracking-widest">
                You are rating
              </span>
              <span className="block text-white text-xl font-bold">
                {currentRatingTarget === "self" ? "YOUR OWN FEELINGS" : "YOUR PARTNER'S FEELINGS"}
              </span>
            </div>
          )}

          <div className="flex-1 flex flex-col items-center justify-center bg-black">
            <p className="text-center text-white mt-20 mb-7 text-2xl">
              How positive or negative did{" "}
              <span className="font-bold underline">
                {currentRatingTarget === "self" ? "YOU" : "YOUR PARTNER"}
              </span>{" "}
              feel during this moment in the conversation?
            </p>
            <VideoPlayer
              ref={videoRef}
              videoSrc={videoSrc}
              onFileChange={handleFileChange}
            />
          </div>
          {videoSrc && !showToggleScreen && !videoEnded && (
            <div className="absolute bottom-0 left-0 w-full cursor-none border-t border-white bg-black px-10 pt-6 pb-8">
              <Slider resetTrigger={resetTrigger} onSample={handleSliderSample} />
            </div>
          )}
          {showToggleScreen && (!videoEnded || awaitingFinalRating) && (
            <div className="absolute inset-0 z-10">
              <RatingOverlay
                currentRatingTarget={currentRatingTarget}
                textInput={textInput}
                setTextInput={setTextInput}
                numberScale={numberScale}
                setNumberScale={setNumberScale}
                attemptedSubmit={attemptedSubmit}
                isFinal={awaitingFinalRating}
                onSubmit={() => void handleTabSubmit()}
                onConfirmIncomplete={handleConfirmIncomplete}
                onDismissIncomplete={handleDismissIncomplete}
              />
            </div>
          )}
          {showTransitionScreen && (
            <TransitionScreen
              ratingTarget={currentRatingTarget}
              onContinue={handleTransitionContinue}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default DyadTaskMain;
