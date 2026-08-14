import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Instructions from "../dyad-task/Instructions";
import VideoWatchPage from "./VideoWatchPage";
import VideoRatingPage from "./VideoRatingPage";
import type { VideoRating } from "./VideoRatingPage";
import CombinedRatingPage from "./CombinedRatingPage";
import type { CombinedRating } from "./CombinedRatingPage";
import VideoSelectionPage from "./VideoSelectionPage";
import type { VideoSelectionResult } from "./VideoSelectionPage";
import type { WatchStats } from "./StimulusPlayer";
import { SET_ASSIGNMENT_METHOD, assignSet, findVideo, resolveVideoSrc } from "./videos";
import { EMPTY_SETTINGS, loadSettings } from "../utils/settings";
import type { AppSettings } from "../utils/settings";
import { shuffle } from "../utils/shuffle";

// Video affective-response task.
//
// Replaces the situational ("scenarios") emotion-rating task. Structure is
// deliberately the same as the task it replaces, so the two remain comparable:
// three targets in random order, the same eight items rated for each, item order
// randomized within a target block. What changed is the item — a film clip
// instead of a written situation — and the scale, 1-100 instead of 1-7.
//
// Two rating modes ship (see VideoRatingMode in utils/settings.ts):
//   separate — three passes over the clips, one perspective at a time. Default.
//   combined — one pass, all three perspectives rated on the same page.
// The machinery below is shared; the mode only decides how many passes there
// are and which rating page is shown.
//
// Every randomization here (set, target order, clip order, emotion order) is
// written to the data file, because a randomization that is not recorded cannot
// be reproduced in analysis.

/** Kept identical to the scenario task so `ratingPerson` stays comparable. */
const RATING_PEOPLE = ["yourself", "your partner", "an average UW-Madison student"];

const targetPhrase = (person: string): string => (person === "yourself" ? "you" : person);

/** Uppercase perspective label. The group asked for these to stand out. */
const targetCaps = (person: string): string => {
  if (person === "yourself") return "YOURSELF";
  if (person === "your partner") return "YOUR PARTNER";
  return "AN AVERAGE UW–MADISON STUDENT";
};

function instructionsFor(settings: AppSettings): string[] {
  const shared = [
    "In this part of the study, you will watch a series of short videos.",
    "After each video, you will rate how strongly it evokes three different feelings, on a scale from 1 (Not at all) to 100 (Extremely).",
    "For each feeling, you will also rate how confident you are in your answer, again from 1 to 100.",
  ];

  if (settings.videoRatingMode === "combined") {
    return [
      ...shared,
      "You will make each of these ratings for three people: for YOURSELF, for YOUR PARTNER, and for AN AVERAGE UW–MADISON STUDENT — all on the same screen.",
      "Please watch each video all the way through before you make your ratings. You can replay a video at any time.",
      "We ask that you answer each question efficiently in order to keep your participation time within one hour.",
    ];
  }

  return [
    ...shared,
    "You will make these ratings three times: once for YOURSELF, once for YOUR PARTNER, and once for AN AVERAGE UW–MADISON STUDENT.",
    "The three people will be presented in random order, and you will see the same videos each time.",
    settings.requireRewatch
      ? "Please watch each video all the way through before you make your ratings."
      : "Please watch each video all the way through the first time. After that you do not have to watch it again, but you can replay it whenever you want to.",
    "We ask that you answer each question efficiently in order to keep your participation time within one hour.",
  ];
}

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

  const [phase, setPhase] = useState<"instructions" | "trials" | "transition" | "selection">(
    "instructions"
  );
  const [instructionIndex, setInstructionIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [page, setPage] = useState<"watch" | "rate">("watch");

  // One draw per participant, made on mount and never re-rolled.
  const [set] = useState(() => assignSet(dyadId));
  const [people] = useState<string[]>(() => shuffle(RATING_PEOPLE));
  const [orderByTarget] = useState<string[][]>(() =>
    RATING_PEOPLE.map(() => shuffle(set.videoIds))
  );
  const [selectionOrder] = useState<string[]>(() => shuffle(set.videoIds));

  const watchedEver = useRef<Set<string>>(new Set());
  const watchStatsRef = useRef<WatchStats>({ plays: 0, firstWatchMs: null });
  const assignmentLoggedRef = useRef(false);
  const loggedOrdersRef = useRef<Set<number>>(new Set());

  const combined = settings.videoRatingMode === "combined";
  /** One pass over the clips when combined, three when separate. */
  const passes = combined ? 1 : people.length;
  const totalTrials = passes * set.videoIds.length;
  const trialsDone = targetIndex * set.videoIds.length + trialIndex;

  const instructions = useMemo(() => instructionsFor(settings), [settings]);

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
  // which set the participant saw, how it was chosen, and which rating mode the
  // session ran in.
  useEffect(() => {
    if (!settingsLoaded || assignmentLoggedRef.current) return;
    assignmentLoggedRef.current = true;
    void (async () => {
      try {
        await writeRow("video_task", "set_assignment", "", "", "", set.id);
        await writeRow("video_task", "set_assignment_method", "", "", "", SET_ASSIGNMENT_METHOD);
        await writeRow("video_task", "set_contents", "", "", "", set.videoIds.join(";"));
        await writeRow("video_task", "target_order", "", "", "", people.join(";"));
        await writeRow("video_task", "rating_mode", "", "", "", settings.videoRatingMode);
        await writeRow(
          "video_task",
          "require_rewatch",
          "",
          "",
          "",
          String(settings.requireRewatch)
        );
      } catch (err) {
        handleError(err);
      }
    })();
  }, [settingsLoaded, settings, set, people, writeRow, handleError]);

  // Record each block's clip order the first time that block starts.
  useEffect(() => {
    if (phase !== "trials" || loggedOrdersRef.current.has(targetIndex)) return;
    loggedOrdersRef.current.add(targetIndex);
    void writeRow(
      "video_task",
      "video_order",
      "",
      "",
      combined ? "all" : people[targetIndex],
      orderByTarget[targetIndex].join(";")
    ).catch(handleError);
  }, [phase, targetIndex, combined, people, orderByTarget, writeRow, handleError]);

  useEffect(() => {
    const detail =
      phase === "instructions"
        ? "Instructions"
        : phase === "selection"
          ? "Choosing videos to share"
          : combined
            ? `Video ${trialIndex + 1} of ${set.videoIds.length}`
            : `Video ${trialIndex + 1} of ${set.videoIds.length} · rating ${people[targetIndex]}`;
    onProgress?.(trialsDone, totalTrials + 1, detail);
  }, [phase, trialIndex, targetIndex, trialsDone, totalTrials, combined, people, set, onProgress]);

  // Instruction screens advance on any deliberate keypress, matching the rest
  // of the app. Auto-repeat from a held key and lone modifiers are ignored —
  // either could blow through several instruction screens at once.
  useEffect(() => {
    if (phase !== "instructions") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (instructionIndex + 1 >= instructions.length) setPhase("trials");
      else setInstructionIndex((i) => i + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, instructionIndex, instructions.length]);

  const currentTarget = people[targetIndex];
  const currentVideoId = orderByTarget[targetIndex]?.[trialIndex];
  const currentVideo = useMemo(
    () => (currentVideoId ? findVideo(currentVideoId) : null),
    [currentVideoId]
  );

  const handleWatched = (stats: WatchStats) => {
    watchStatsRef.current = stats;
    if (currentVideoId) watchedEver.current.add(currentVideoId);
  };

  const handleWatchContinue = async () => {
    if (!currentVideoId) return;
    const stats = watchStatsRef.current;
    const person = combined ? "all" : currentTarget;
    try {
      await writeRow("video_affect", currentVideoId, "", "watch_plays", person, stats.plays);
      await writeRow(
        "video_affect",
        currentVideoId,
        "",
        "first_watch_ms",
        person,
        stats.firstWatchMs ?? ""
      );
    } catch (err) {
      handleError(err);
    }
    watchStatsRef.current = { plays: 0, firstWatchMs: null };
    setPage("rate");
  };

  /** Shared tail of both rating pages: advance, or move on to the next phase. */
  const advanceAfterRating = () => {
    const lastTrial = trialIndex + 1 >= orderByTarget[targetIndex].length;
    if (!lastTrial) {
      setTrialIndex((i) => i + 1);
      setPage("watch");
      return;
    }
    if (targetIndex + 1 < passes) {
      setPhase("transition");
      return;
    }
    setPhase("selection");
  };

  const handleRatingSubmit = async (ratings: VideoRating[], replays: number) => {
    if (!currentVideoId) return;
    try {
      // Long format: one row per (emotion, measure), matching the scenario task
      // it replaces so the same analysis scripts read both.
      for (const r of ratings) {
        await writeRow("video_affect", currentVideoId, r.emotion, "intensity", currentTarget, r.intensity);
        await writeRow("video_affect", currentVideoId, r.emotion, "confidence", currentTarget, r.confidence);
      }
      await writeRow("video_affect", currentVideoId, "", "rating_page_replays", currentTarget, replays);
    } catch (err) {
      handleError(err);
    }
    advanceAfterRating();
  };

  const handleCombinedSubmit = async (ratings: CombinedRating[], replays: number) => {
    if (!currentVideoId) return;
    try {
      // Same row shape as above — the person just varies within the page
      // instead of within the block.
      for (const r of ratings) {
        await writeRow("video_affect", currentVideoId, r.emotion, "intensity", r.person, r.intensity);
        await writeRow("video_affect", currentVideoId, r.emotion, "confidence", r.person, r.confidence);
      }
      await writeRow("video_affect", currentVideoId, "", "rating_page_replays", "all", replays);
    } catch (err) {
      handleError(err);
    }
    advanceAfterRating();
  };

  const handleTransitionContinue = () => {
    setTargetIndex((i) => i + 1);
    setTrialIndex(0);
    setPage("watch");
    setPhase("trials");
  };

  const handleSelectionSubmit = async (result: VideoSelectionResult) => {
    try {
      await writeRow("video_selection", "for_partner", "", "", "", result.forPartner.join(";"));
      await writeRow("video_selection", "for_self", "", "", "", result.forSelf.join(";"));
      await writeRow("video_selection", "for_average_student", "", "", "", result.forAverage.join(";"));
      await writeRow("video_selection", "presented_order", "", "", "", result.presentedOrder.join(";"));
      await writeRow("video_selection", "n_for_partner", "", "", "", result.forPartner.length);
      await writeRow("video_selection", "n_for_self", "", "", "", result.forSelf.length);
      await writeRow("video_selection", "n_for_average_student", "", "", "", result.forAverage.length);
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
          // splitting 4 + 2 (combined mode) or 4 + 3 (separate mode).
          groupSize={instructions.length}
          instructions={instructions}
        />
      </div>
    );
  }

  if (phase === "transition") {
    return (
      <div className="min-h-screen w-full flex flex-col justify-center items-center bg-black overflow-hidden">
        <div className="max-w-4xl mx-auto text-center px-8">
          <h1 className="text-white text-2xl">Phase Complete!</h1>
          <p className="text-white text-2xl pt-24">
            You have completed all video ratings for{" "}
            <span className="font-bold">{targetCaps(people[targetIndex])}</span>.
          </p>
          <p className="text-white text-2xl pt-24">
            You will now rate the same videos for{" "}
            <span className="font-bold underline">{targetCaps(people[targetIndex + 1])}</span>.
          </p>
          <button
            type="button"
            onClick={handleTransitionContinue}
            className="mt-24 px-8 py-4 text-white text-xl border border-white bg-black hover:bg-gray-800 transition-colors"
          >
            Continue
          </button>
        </div>
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

  if (!currentVideo || !currentVideoId) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black">
        <h1 className="text-white text-4xl font-bold">Loading...</h1>
      </div>
    );
  }

  const positionLabel = `Video ${trialIndex + 1} of ${orderByTarget[targetIndex].length}`;

  if (page === "watch") {
    return (
      <VideoWatchPage
        key={`watch-${targetIndex}-${trialIndex}`}
        src={srcFor(currentVideoId)}
        positionLabel={positionLabel}
        targetReminder={combined ? null : targetCaps(currentTarget)}
        alreadyWatchedEarlier={watchedEver.current.has(currentVideoId)}
        requireWatch={settings.requireRewatch}
        onWatched={handleWatched}
        onContinue={handleWatchContinue}
      />
    );
  }

  return combined ? (
    <CombinedRatingPage
      key={`rate-${trialIndex}`}
      videoId={currentVideoId}
      emotions={currentVideo.emotions}
      people={people}
      src={srcFor(currentVideoId)}
      positionLabel={positionLabel}
      onSubmit={handleCombinedSubmit}
    />
  ) : (
    <VideoRatingPage
      key={`rate-${targetIndex}-${trialIndex}`}
      videoId={currentVideoId}
      emotions={currentVideo.emotions}
      src={srcFor(currentVideoId)}
      targetPhrase={targetPhrase(currentTarget)}
      targetCaps={targetCaps(currentTarget)}
      isSelf={currentTarget === "yourself"}
      positionLabel={positionLabel}
      onSubmit={handleRatingSubmit}
    />
  );
}
