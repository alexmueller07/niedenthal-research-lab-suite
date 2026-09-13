import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Instructions from "../dyad-task/Instructions";
import PerspectiveNotice from "../components/PerspectiveNotice";
import VideoWatchPage from "./VideoWatchPage";
import VideoRatingPage, { SCALE_MAX, SCALE_MIN } from "./VideoRatingPage";
import type { VideoRatingResult } from "./VideoRatingPage";
import VideoSelectionPage from "./VideoSelectionPage";
import type { VideoSelectionResult } from "./VideoSelectionPage";
import type { WatchStats } from "./StimulusPlayer";
import { SET_ASSIGNMENT_METHOD, assignSet, findVideo, resolveVideoSrc } from "./videos";
import { EMPTY_SETTINGS, loadSettings } from "../utils/settings";
import type { AppSettings } from "../utils/settings";
import { shuffle } from "../utils/shuffle";

// Video affective-response task.
//
// Restructured to Randy's 2026-08-05 specification. What each participant does
// now, for each of the eight clips in their set:
//
//   1. watch the clip once,
//   2. an announcement screen naming a perspective, held for three seconds,
//   3. rate the clip's three emotions from that perspective, 1-7,
//   4. the other announcement screen,
//   5. the same three emotions from the other perspective.
//
// Three things changed from the version before it, and all three matter to the
// analysis rather than to the interface:
//
//   - the average-UW-student perspective is gone. Two targets, not three.
//   - which perspective comes first is drawn per clip, not per participant.
//     Whatever a first-versus-second position does to a rating, it now varies
//     within participant and averages out of the self-partner difference —
//     which is the quantity the study is actually about. One draw per
//     participant would have left that difference confounded with order for
//     everyone.
//   - each clip is watched once, not once per perspective. Both ratings are
//     made from the same viewing, so a difference between them cannot come
//     from having seen the clip a different number of times. (The clip stays on
//     both rating pages for a participant who wants another look, and replays
//     are counted.)
//
// Every randomization here (set, clip order, per-clip perspective order,
// emotion order) is written to the data file, because a randomization that is
// not recorded cannot be reproduced in analysis.

type Target = "self" | "partner";

/** How the target is named in the data file. Unchanged, so old rows still join. */
const TARGET_NAME: Record<Target, string> = {
  self: "yourself",
  partner: "your partner",
};

const INSTRUCTIONS = [
  "In this part of the study, you will watch a series of short videos.",
  "After each video, you will answer the same questions twice: once about how YOU felt while watching it, and once about how YOUR PARTNER would feel while watching it.",
  "A screen before each set of questions will tell you which of the two you are answering. Please read it — it changes from video to video.",
  "Every question is answered on a scale from 1 (Not at all) to 7 (Extremely).",
  "Please watch each video all the way through. You can replay it on the question pages at any time.",
  "We ask that you answer each question efficiently in order to keep your participation time within one hour.",
];

export type VideoTaskWriteRow = (
  ratingTask: string,
  subTask: string,
  emotion1: string,
  emotion2: string,
  ratingPerson: string,
  response: number | string
) => Promise<void>;

interface VideoTaskMainProps {
  /** Dyad ID, used to yoke the video set across both members of the dyad. */
  dyadId: string;
  writeRow: VideoTaskWriteRow;
  /** Reports trial progress so the researcher dashboard can show it. */
  onProgress?: (done: number, total: number, label: string) => void;
  onComplete: () => void;
  onCsvError?: (err: unknown) => void;
}

export default function VideoTaskMain({
  dyadId,
  writeRow,
  onProgress,
  onComplete,
  onCsvError,
}: VideoTaskMainProps) {
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [phase, setPhase] = useState<"instructions" | "trials" | "selection">("instructions");
  const [instructionIndex, setInstructionIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  /** Which of the trial's two perspectives is being collected: 0 or 1. */
  const [perspectiveIndex, setPerspectiveIndex] = useState(0);
  const [page, setPage] = useState<"watch" | "notice" | "rate">("watch");

  // One draw per participant, made on mount and never re-rolled.
  const [set] = useState(() => assignSet(dyadId));
  const [videoOrder] = useState<string[]>(() => shuffle(set.videoIds));
  /** Perspective order for each clip, indexed the same way as videoOrder. */
  const [perspectiveOrders] = useState<Target[][]>(() =>
    set.videoIds.map(() => shuffle(["self", "partner"] as Target[]))
  );
  /**
   * Emotion order per clip, drawn once and shared by both perspectives of that
   * clip — the second page is meant to mirror the first, not re-order it.
   */
  const [emotionOrders] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(set.videoIds.map((id) => [id, shuffle(findVideo(id).emotions)]))
  );
  const [selectionOrder] = useState<string[]>(() => shuffle(set.videoIds));

  const watchStatsRef = useRef<WatchStats>({ plays: 0, firstWatchMs: null });
  const assignmentLoggedRef = useRef(false);

  const totalTrials = videoOrder.length;

  const handleError = useCallback(
    (err: unknown) => {
      console.error("Video task write failed:", err);
      onCsvError?.(err);
    },
    [onCsvError]
  );

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
    });
  }, []);

  const srcFor = useCallback(
    (id: string) => resolveVideoSrc(id, settings.stimulusDir),
    [settings.stimulusDir]
  );

  // Record the draw once, before any rating rows, so the data file always says
  // which set the participant saw, how it was chosen, and — trial by trial —
  // which perspective they were asked for first.
  useEffect(() => {
    if (!settingsLoaded || assignmentLoggedRef.current) return;
    assignmentLoggedRef.current = true;
    void (async () => {
      try {
        await writeRow("video_task", "set_assignment", "", "", "", set.id);
        await writeRow("video_task", "set_assignment_method", "", "", "", SET_ASSIGNMENT_METHOD);
        await writeRow("video_task", "set_contents", "", "", "", set.videoIds.join(";"));
        await writeRow("video_task", "video_order", "", "", "", videoOrder.join(";"));
        await writeRow("video_task", "scale", "", "", "", `${SCALE_MIN}-${SCALE_MAX}`);
        for (const [index, videoId] of videoOrder.entries()) {
          await writeRow(
            "video_task",
            "perspective_order",
            videoId,
            "",
            "",
            perspectiveOrders[index].map((t) => TARGET_NAME[t]).join(";")
          );
          await writeRow(
            "video_task",
            "emotion_order",
            videoId,
            "",
            "",
            emotionOrders[videoId].join(";")
          );
        }
      } catch (err) {
        handleError(err);
      }
    })();
  }, [
    settingsLoaded,
    set,
    videoOrder,
    perspectiveOrders,
    emotionOrders,
    writeRow,
    handleError,
  ]);

  useEffect(() => {
    const detail =
      phase === "instructions"
        ? "Instructions"
        : phase === "selection"
          ? "Choosing videos to share"
          : `Video ${trialIndex + 1} of ${totalTrials}`;
    onProgress?.(trialIndex, totalTrials + 1, detail);
  }, [phase, trialIndex, totalTrials, onProgress]);

  // Instruction screens advance on any deliberate keypress, matching the rest
  // of the app. Auto-repeat from a held key and lone modifiers are ignored —
  // either could blow through several instruction screens at once.
  useEffect(() => {
    if (phase !== "instructions") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (instructionIndex + 1 >= INSTRUCTIONS.length) setPhase("trials");
      else setInstructionIndex((i) => i + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, instructionIndex]);

  const currentVideoId = videoOrder[trialIndex];
  const currentVideo = useMemo(
    () => (currentVideoId ? findVideo(currentVideoId) : null),
    [currentVideoId]
  );
  const currentTarget: Target | undefined =
    perspectiveOrders[trialIndex]?.[perspectiveIndex];

  const handleWatched = (stats: WatchStats) => {
    watchStatsRef.current = stats;
  };

  const handleWatchContinue = async () => {
    if (!currentVideoId) return;
    const stats = watchStatsRef.current;
    try {
      await writeRow("video_affect", currentVideoId, "", "watch_plays", "", stats.plays);
      await writeRow(
        "video_affect",
        currentVideoId,
        "",
        "first_watch_ms",
        "",
        stats.firstWatchMs ?? ""
      );
    } catch (err) {
      handleError(err);
    }
    watchStatsRef.current = { plays: 0, firstWatchMs: null };
    setPage("notice");
  };

  const handleRatingSubmit = async (result: VideoRatingResult) => {
    if (!currentVideoId || !currentTarget) return;
    const person = TARGET_NAME[currentTarget];
    try {
      // Long format: one row per (emotion, measure), matching the task this
      // replaced so the same analysis scripts read both.
      for (const r of result.ratings) {
        await writeRow(
          "video_affect",
          currentVideoId,
          r.emotion,
          "intensity",
          person,
          r.intensity
        );
      }
      if (currentTarget === "partner") {
        // One confidence rating for the partner page as a whole — Randy,
        // 2026-08-05. Written with no emotion so it cannot be mistaken for a
        // per-emotion value by a script joining on emotion1.
        await writeRow("video_affect", currentVideoId, "", "confidence", person, result.confidence);
      }
      await writeRow(
        "video_affect",
        currentVideoId,
        "",
        "rating_page_replays",
        person,
        result.replays
      );
      // Position within the trial, so an order effect can be tested for rather
      // than assumed absent.
      await writeRow(
        "video_affect",
        currentVideoId,
        "",
        "perspective_position",
        person,
        perspectiveIndex + 1
      );
    } catch (err) {
      handleError(err);
    }

    if (perspectiveIndex + 1 < perspectiveOrders[trialIndex].length) {
      setPerspectiveIndex((i) => i + 1);
      setPage("notice");
      return;
    }
    if (trialIndex + 1 < videoOrder.length) {
      setTrialIndex((i) => i + 1);
      setPerspectiveIndex(0);
      setPage("watch");
      return;
    }
    setPhase("selection");
  };

  const handleSelectionSubmit = async (result: VideoSelectionResult) => {
    try {
      await writeRow("video_selection", "for_partner", "", "", "", result.forPartner.join(";"));
      await writeRow("video_selection", "for_self", "", "", "", result.forSelf.join(";"));
      await writeRow("video_selection", "presented_order", "", "", "", result.presentedOrder.join(";"));
      await writeRow("video_selection", "column_order", "", "", "", result.columnOrder.join(";"));
      await writeRow("video_selection", "n_for_partner", "", "", "", result.forPartner.length);
      await writeRow("video_selection", "n_for_self", "", "", "", result.forSelf.length);
    } catch (err) {
      handleError(err);
    }
    onProgress?.(totalTrials + 1, totalTrials + 1, "Video affective-response task");
    onComplete();
  };

  if (!settingsLoaded) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black">
        <h1 className="text-white text-4xl font-bold">Loading...</h1>
      </div>
    );
  }

  if (phase === "instructions") {
    return (
      <div className="overflow-hidden h-screen justify-center items-center">
        <Instructions
          instructionIndex={instructionIndex}
          onBack={() => setInstructionIndex((i) => Math.max(0, i - 1))}
          // Equal to the count so the screens build up on one page rather than
          // splitting into groups.
          groupSize={INSTRUCTIONS.length}
          instructions={INSTRUCTIONS}
        />
      </div>
    );
  }

  if (phase === "selection") {
    return (
      <VideoSelectionPage
        videoIds={selectionOrder}
        srcFor={srcFor}
        onSubmit={handleSelectionSubmit}
      />
    );
  }

  if (!currentVideo || !currentVideoId || !currentTarget) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black">
        <h1 className="text-white text-4xl font-bold">Loading...</h1>
      </div>
    );
  }

  const positionLabel = `Video ${trialIndex + 1} of ${videoOrder.length}`;

  if (page === "watch") {
    return (
      <VideoWatchPage
        key={`watch-${trialIndex}`}
        src={srcFor(currentVideoId)}
        positionLabel={positionLabel}
        onWatched={handleWatched}
        onContinue={handleWatchContinue}
      />
    );
  }

  if (page === "notice") {
    return (
      <PerspectiveNotice
        key={`notice-${trialIndex}-${perspectiveIndex}`}
        headline={
          currentTarget === "self" ? (
            <>
              You will now be reporting how <span className="font-bold underline">YOU</span>{" "}
              felt.
            </>
          ) : (
            <>
              You will now be reporting how{" "}
              <span className="font-bold underline">YOUR PARTNER</span> would feel.
            </>
          )
        }
        onContinue={() => setPage("rate")}
      />
    );
  }

  return (
    <VideoRatingPage
      key={`rate-${trialIndex}-${perspectiveIndex}`}
      videoId={currentVideoId}
      emotions={emotionOrders[currentVideoId]}
      src={srcFor(currentVideoId)}
      target={currentTarget}
      positionLabel={positionLabel}
      onSubmit={handleRatingSubmit}
    />
  );
}
