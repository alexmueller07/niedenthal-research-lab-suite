import { useCallback, useEffect, useRef, useState } from "react";

import StationSetup from "./setup/StationSetup";
import { fnv1aHex } from "./utils/hash";
import DyadTaskMain from "./dyad-task/DyadTaskMain";
import ClassificationTaskMain from "./classification-task/ClassificationTaskMain";
import PostConversation from "./classification-task/PostConversation";
import type { ClassificationStepData } from "./classification-task/types";
import { createTransitionsWriter } from "./utils/transitions";
import type { TransitionsWriter } from "./utils/transitions";
import ErrorBanner from "./components/ErrorBanner";
import AdminQuitModal from "./components/AdminQuitModal";
import HelpButton from "./components/HelpButton";
import SessionStrip from "./components/SessionStrip";
import RoundComplete from "./rounds/RoundComplete";
import { ratingsFileName, recordRound, transitionsFileName } from "./rounds/rounds";
import type { RoundRecord } from "./rounds/rounds";
import { nowHHMM, todayISO } from "./roundrobin/sessionBoard";
import SignIn from "./roundrobin/SignIn";
import Welcome from "./roundrobin/Welcome";
import AdminDashboard from "./roundrobin/AdminDashboard";
import { emptyData, loadData, mergeData, saveData, signIn as rrSignIn } from "./roundrobin/store";
import type { RRData, RRParticipant } from "./roundrobin/store";
import {
  isHelpOpen,
  loadProgress,
  mergeProgress,
  overallFraction,
  saveProgress,
  stageLabel,
} from "./roundrobin/progress";
import type { RRProgress, StageKey } from "./roundrobin/progress";
import {
  describeVideo,
  findDyadVideos,
  hasTauri,
  leaveMode,
  prepareLocalVideo,
  remoteConfigure,
  remoteStatus,
  reportStudyProgress,
} from "./remote/api";
import type { CopyProgress, DyadVideo, RemotePublic } from "./remote/api";
import { EMPTY_SETTINGS, loadSettings, saveSettings } from "./utils/settings";
import type { AppSettings } from "./utils/settings";
import { flushAll } from "./utils/flushRegistry";
import { isBlockedShortcut } from "./utils/lockdown";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface FormData {
  dyadId: string;
  /**
   * Study group, A / B / C. Metadata only — the app runs identically for all
   * three. It is the last column of both data files, appended rather than
   * inserted so every column the pilot analysis scripts read by position
   * stayed where it was.
   */
  groupId: string;
  participantId: string;
  partnerId: string;
  computer: string;
  subjectInitials: string;
  saveFolder: string;
  raName: string;
  sessionTime: string;
  sessionDate: string;
  /**
   * Nametag colours for this round's pairing. Written to both data files and
   * shown at the bottom of the participant's screen (SessionStrip).
   *
   * Randy, 2026-09-19. The seat alone stopped being enough the moment a
   * participant does several conversations in an afternoon: "Left" is where
   * they sat, not who they talked to, and the partner changes every round. The
   * colour is what the lab hands out at the door and what the RAs say out loud,
   * so it is the identifier a mistake is actually visible in.
   *
   * Empty when the RA typed study IDs by hand instead of tapping a colour — the
   * app never invents one.
   */
  participantColor: string;
  partnerColor: string;
  /**
   * Which conversation of this participant's this is. 1-based and continuing
   * across days: somebody who did two rounds last week comes back on R3. The
   * number comes from the round ledger (rounds/rounds.ts) rather than a counter
   * in this process, because the process does not survive the afternoon.
   */
  round: number;
}

/**
 * Where the automatic conversation-video fetch currently stands.
 *
 * Kicked off the moment the RA picks who is sitting here, so the ~1 GB copy
 * off the Research Drive runs while the handover and the first questionnaire
 * happen — by the time the rating task wants the video, it is usually already
 * local.
 *
 * Keyed on the dyad number since 2026-09-24. It used to be keyed on the
 * participant's email address through Round Robin, which needed a session, a
 * rotation, a claimed room, the participant on the schedule and the address
 * they signed in with all to line up before a file three feet away could be
 * played.
 *
 * "choose" appears only when more than one recording is filed under the dyad:
 * which conversation gets rated is a protocol decision, so the RA picks rather
 * than the app guessing. Every state leaves the manual file picker reachable —
 * the pipeline must never block a session.
 */
export type ConversationPrep =
  | { status: "idle" }
  | { status: "finding" }
  | { status: "choose"; videos: DyadVideo[]; recommended: DyadVideo }
  | {
      status: "copying";
      /** Null for a file the RA browsed to — there is no dyad video behind it. */
      video: DyadVideo | null;
      /**
       * What the Rust copier is emitting progress under. Held explicitly rather
       * than read off `video`, because a hand-picked file has no dyad video and
       * its copy still has to be able to report progress.
       */
      recordingId: string;
      videos: DyadVideo[];
      copiedBytes: number;
      totalBytes: number;
    }
  /**
   * Playable. `video` is null for a file the RA browsed to by hand — there is
   * no dyad recording behind it, and nothing downstream needs one.
   */
  | { status: "ready"; video: DyadVideo | null; videos: DyadVideo[]; localPath: string }
  | { status: "failed"; message: string; videos: DyadVideo[] };

/**
 * Where the session is.
 *
 * "setup" comes first as of 2026-08-22. It used to come after the participant
 * had signed in, which meant they sat down, typed their email, and then waited
 * while an RA reached over them to fill in study IDs — the lab flagged it on
 * the first walkthrough. The RA now sets the station up, hands the computer
 * over, and the sign-in screen is the first thing the participant sees.
 */
/**
 * "roundComplete" arrived on 2026-09-19 with the multi-round session. It is the
 * screen between two conversations: the participant is told to fetch their
 * researcher, this round's files are closed, and the RA decides whether there
 * is another round or whether the day is over. Before it, the only thing after
 * a session was the end of the session.
 */
type Stage = "setup" | "signin" | "welcome" | "admin" | "study" | "roundComplete";

function App() {
  const [formData, setFormData] = useState<FormData>({
    dyadId: "",
    groupId: "",
    participantId: "",
    partnerId: "",
    computer: "",
    subjectInitials: "",
    saveFolder: "",
    raName: "",
    sessionTime: "",
    sessionDate: "",
    participantColor: "",
    partnerColor: "",
    round: 1,
  });

  /**
   * What the participant is doing right now.
   *
   * There is nothing here that runs once per session any more. Every page a
   * participant sees belongs to a conversation, so every page repeats with it —
   * including the video-sharing page, which is the last step of the short-video
   * task rather than a thing of its own (Ben, 2026-09-21: "the whole thing
   * (rating emotions and me/my partner would enjoy) is the TikTok task… both
   * parts of the task should have the same videos within-rounds").
   */
  const [selectedTask, setSelectedTask] = useState<
    "postConversation" | "dyad" | "classification" | null
  >(null);
  const [dyadCsvFilePath, setDyadCsvFilePath] = useState<string>("");
  const [sessionFolder, setSessionFolder] = useState<string>("");
  // One writer for this round's transitions file, created once the save folder
  // exists. Both the post-conversation questionnaire and the questionnaire task
  // write through it, so the file's trial numbering stays a single sequence —
  // see utils/transitions.ts. It is replaced at the start of every round,
  // because every round writes its own file and each one numbers trials from 1.
  const transitionsWriterRef = useRef<TransitionsWriter | null>(null);
  const [taskOrder, setTaskOrder] = useState<number>(0);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showAdminQuit, setShowAdminQuit] = useState<boolean>(false);

  const [stage, setStage] = useState<Stage>("setup");
  /**
   * Where "Back to setup" on the researcher dashboard returns to. The dashboard
   * is reachable from two places — the setup screen, and the participant
   * sign-in via admin@admin — and dropping an RA back onto the wrong one costs
   * them the handover they had already made.
   */
  const [adminReturn, setAdminReturn] = useState<Stage>("setup");
  const [rrData, setRrData] = useState<RRData | null>(null);
  const [rrParticipant, setRrParticipant] = useState<RRParticipant | null>(null);
  const [rrIsNew, setRrIsNew] = useState<boolean>(false);

  // Live progress for the researcher dashboard, written on every step change.
  // Held in a ref rather than state: it is reported from inside task callbacks
  // and nothing in this component renders from it, so keeping it out of the
  // render cycle avoids re-rendering the running task on every trial.
  const progressRef = useRef<RRProgress | null>(null);
  const [helpPending, setHelpPending] = useState<boolean>(false);
  /**
   * The participant has finished everything, not just this round.
   *
   * It used to be enough to notice that both tasks had reported done; that flag
   * is gone, because "both tasks are done" now means the end of a round and
   * says nothing about the end of the day. Which round is the last one is a
   * decision the RA makes on the round-complete screen, not something the tasks
   * can conclude on their own.
   */
  const [sessionDone, setSessionDone] = useState<boolean>(false);
  /**
   * The round this station just finished, and whose it was.
   *
   * The setup screen normally reads the next round number off the ledger on
   * disk. This is the same fact held in memory, and it exists because the two
   * can disagree in one direction that matters: if the ledger write failed, the
   * disk still says the participant's last round was the one before, and the
   * setup screen would point round N+1 at the files round N just wrote.
   *
   * Carries the participant ID because a station does not always keep the same
   * participant — an RA who mistypes a study ID and corrects it must get that
   * participant's round number, not the previous one's.
   */
  const [lastCompletedRound, setLastCompletedRound] = useState<{
    participantId: string;
    round: number;
  } | null>(null);
  // Cursor position is the measurement during the continuous rating, so the
  // help button has to disappear while that runs — see DyadTaskMain.
  const [cursorLocked, setCursorLocked] = useState<boolean>(false);

  // The Round Robin server connection (URL + drive mount), configured once per
  // machine. Null until loaded; treated as "not configured" — everything remote
  // is skipped — until it says otherwise.
  const [remote, setRemote] = useState<RemotePublic | null>(null);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [prep, setPrep] = useState<ConversationPrep>({ status: "idle" });
  /**
   * The dyad the video search has already run for, so picking the same person
   * twice does not throw away a copy that is nearly done.
   */
  const searchedDyadRef = useRef<string>("");

  useEffect(() => {
    void loadData().then(setRrData);
    void loadSettings().then(setSettings);
    if (hasTauri()) {
      void remoteStatus()
        .then(setRemote)
        .catch(() => setRemote(null));
    }
  }, []);

  const remoteReady = Boolean(remote?.roundRobinUrl);

  const persistRr = (data: RRData) => {
    setRrData(data);
    void saveData(data).catch((err) => {
      console.error("Round-robin save failed:", err);
      setCsvError(`Round-robin save failed: ${err}`);
    });
  };

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
    void saveSettings(next).catch((err) => console.error("Settings save failed:", err));
  }, []);

  const handleDriveChange = useCallback(async (path: string) => {
    const next = await remoteConfigure({ researchDriveRoot: path });
    setRemote(next);
  }, []);

  const writeProgress = useCallback(
    (email: string, patch: Partial<RRProgress>) => {
      const next = mergeProgress(progressRef.current ?? undefined, email, patch);
      progressRef.current = next;
      // Progress tracking is a convenience for the researcher, never study data:
      // a failed write is logged and dropped rather than interrupting a session.
      void saveProgress(next).catch((err) => console.error("Progress save failed:", err));

      // Mirror the same update to the Round Robin session board, so the RAs
      // running the session watch every rating station live without walking
      // over. Same convenience-not-data rule: failures are logged and dropped.
      if (hasTauri() && remoteReady) {
        const stageText = next.detail
          ? `${stageLabel(next.stage)} — ${next.detail}`
          : stageLabel(next.stage);
        void reportStudyProgress(
          email,
          stageText,
          Math.round(overallFraction(next) * 100),
          isHelpOpen(next)
        ).catch((err) => console.error("Round Robin progress report failed:", err));
      }
    },
    [remoteReady]
  );

  const reportProgress = useCallback(
    (stage: StageKey, done: number, total: number, detail: string) => {
      const email = rrParticipant?.email;
      if (!email) return;
      writeProgress(email, { stage, done, total, detail });
    },
    [rrParticipant, writeProgress]
  );

  const handleRequestHelp = () => {
    const email = rrParticipant?.email;
    if (!email) return;
    setHelpPending(true);
    writeProgress(email, {
      helpRequestedAt: new Date().toISOString(),
      helpResolvedAt: null,
    });
  };

  // The participant withdrawing their own request. Resolving it (rather than
  // erasing the request) keeps the fact that they asked in the progress file —
  // an RA looking back at a session should still be able to see it happened.
  const handleCancelHelp = () => {
    const email = rrParticipant?.email;
    if (!email) return;
    setHelpPending(false);
    writeProgress(email, { helpResolvedAt: new Date().toISOString() });
  };

  // While a help request is outstanding, watch for the researcher clearing it
  // so the participant's "researcher notified" notice goes away on its own.
  useEffect(() => {
    if (!helpPending || !rrParticipant) return;
    const id = window.setInterval(() => {
      void loadProgress().then((all) => {
        const mine = all[rrParticipant.email];
        if (mine && !isHelpOpen(mine)) {
          progressRef.current = { ...(progressRef.current ?? mine), ...mine };
          setHelpPending(false);
        }
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, [helpPending, rrParticipant]);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    // Capture-phase keydown: opens the researcher quit gate and suppresses
    // browser/OS escape shortcuts before the task-level handlers see them.
    const onKeyDown = (e: KeyboardEvent) => {
      // Researcher-only save-and-quit gate: Ctrl+Shift+Q.
      if (e.ctrlKey && e.shiftKey && (e.key === "Q" || e.key === "q")) {
        e.preventDefault();
        e.stopPropagation();
        setShowAdminQuit(true);
        return;
      }
      if (isBlockedShortcut(e)) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown, true); // capture phase

    // Primary path for Ctrl+Shift+Q: an OS-level global shortcut registered in
    // Rust. It fires even when the webview does not have keyboard focus (the
    // reason the keydown-only version was unreliable). The keydown listener
    // above stays as a fallback and for browser dev.
    //
    // Rust emits the same "admin-quit" event when the window's close button is
    // used, so the X opens this modal rather than exiting without flushing.
    let unlistenQuit: (() => void) | null = null;
    if ("__TAURI_INTERNALS__" in window) {
      void listen("admin-quit", () => setShowAdminQuit(true)).then((un) => {
        unlistenQuit = un;
      });
    }

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown, true);
      unlistenQuit?.();
    };
  }, []);

  // Flush any in-memory data to disk, then quit. Triggered only from the
  // researcher AdminQuitModal.
  const handleConfirmQuit = async () => {
    try {
      await flushAll();
    } catch (err) {
      console.error("Flush before quit failed:", err);
    }
    try {
      await invoke("exit_app");
    } catch (err) {
      console.error("exit_app failed:", err);
    }
  };

  /** Same flush, but the app stays open and lands on the mode chooser. */
  const handleLeaveMode = useCallback(async () => {
    try {
      await flushAll();
    } catch (err) {
      console.error("Flush before leaving the mode failed:", err);
    }
    try {
      await leaveMode(null);
    } catch (err) {
      setCsvError(String(err));
    }
  }, []);

  // The chooser asking this window to hand the computer over to another mode.
  // Everything buffered goes to disk first — up to ~15 s of slider samples sit
  // in memory during the rating task, and they are the measurement.
  useEffect(() => {
    if (!hasTauri()) return;
    let unlisten: (() => void) | null = null;
    void listen<string>("leave-mode", (event) => {
      void (async () => {
        try {
          await flushAll();
        } catch (err) {
          console.error("Flush before the mode switch failed:", err);
        }
        try {
          await leaveMode((event.payload as "record" | "station" | "control") ?? null);
        } catch (err) {
          setCsvError(String(err));
        }
      })();
    }).then((un) => {
      unlisten = un;
    });
    return () => unlisten?.();
  }, []);

  // ---- automatic conversation-video fetch ---------------------------------

  // Progress events from the Rust copy loop. One global listener; events for a
  // recording that is no longer the one being prepared are dropped.
  useEffect(() => {
    if (!hasTauri()) return;
    let unlisten: (() => void) | null = null;
    void listen<CopyProgress>("conversation-copy-progress", (event) => {
      setPrep((current) =>
        current.status === "copying" &&
        current.recordingId === event.payload.recordingId
          ? {
              ...current,
              copiedBytes: event.payload.copiedBytes,
              totalBytes: event.payload.totalBytes,
            }
          : current
      );
    }).then((un) => {
      unlisten = un;
    });
    return () => unlisten?.();
  }, []);

  // By the time the video fetch resolves, the RA has usually left this station
  // — the participant is mid-questionnaire. Mirroring the outcome to the Round
  // Robin board (with the help flag on failure) is what lets the RA notice a
  // problem from the control page instead of discovering it over the
  // participant's shoulder ten minutes later.
  const reportStationEvent = useCallback(
    (text: string, needsHelp: boolean) => {
      const email = rrParticipant?.email;
      if (!email || !hasTauri() || !remoteReady) return;
      void reportStudyProgress(email, text, null, needsHelp).catch((err) =>
        console.error("Round Robin station event failed:", err)
      );
    },
    [rrParticipant, remoteReady]
  );

  const prepareVideo = useCallback(
    (video: DyadVideo, videos: DyadVideo[]) => {
      setPrep({
        status: "copying",
        video,
        recordingId: video.recordingId,
        videos,
        copiedBytes: 0,
        totalBytes: 0,
      });
      void prepareLocalVideo(video.recordingId, video.path)
        .then((prepared) => {
          setPrep({ status: "ready", video, videos, localPath: prepared.localPath });
          reportStationEvent(`Conversation video ready — ${describeVideo(video)}`, false);
        })
        .catch((err) => {
          setPrep({ status: "failed", message: String(err), videos });
          reportStationEvent("Conversation video fetch FAILED — check station", true);
        });
    },
    [reportStationEvent]
  );

  /**
   * A file the RA browsed to on the setup screen.
   *
   * Copied into the same local cache a fetched recording lands in rather than
   * played from where it sits: browsing almost always means browsing to the
   * Research Drive, and streaming a gigabyte over SMB while the slider is
   * sampled against video time every 100 ms is how a stall becomes a hole in
   * the data.
   */
  const prepareFile = useCallback(
    (path: string) => {
      const recordingId = `manual-${fnv1aHex(path)}`;
      setPrep({
        status: "copying",
        video: null,
        recordingId,
        videos: [],
        copiedBytes: 0,
        totalBytes: 0,
      });
      void prepareLocalVideo(recordingId, path)
        .then((prepared) => {
          setPrep({
            status: "ready",
            video: null,
            videos: [],
            localPath: prepared.localPath,
          });
        })
        .catch((err) => setPrep({ status: "failed", message: String(err), videos: [] }));
    },
    []
  );

  /**
   * Finds the conversation filed under this dyad and starts copying it.
   *
   * Fire-and-forget: the session moves on either way, and the dyad task falls
   * back to the manual picker if this never succeeds. The lab's standing rule
   * is that the pipeline never delays a session.
   */
  const startConversationSearch = useCallback(
    (dyadId: string) => {
      if (!hasTauri() || !dyadId) return;
      searchedDyadRef.current = dyadId;
      setPrep({ status: "finding" });
      void findDyadVideos(dyadId)
        .then((videos) => {
          const recommended = videos[0];
          if (!recommended) {
            setPrep({
              status: "failed",
              message: `Nothing is filed under dyad ${dyadId} on the Research Drive yet. If the conversation just ended, the recording room may still be copying it — press "Look again" in a moment.`,
              videos: [],
            });
            return;
          }
          if (videos.length === 1) {
            prepareVideo(recommended, videos);
          } else {
            // More than one conversation filed under this dyad — which one gets
            // rated is a protocol decision, so the RA picks. Newest preselected.
            setPrep({ status: "choose", videos, recommended });
          }
        })
        .catch((err) => setPrep({ status: "failed", message: String(err), videos: [] }));
    },
    [prepareVideo]
  );

  /**
   * The moment the station knows which dyad it is, go and find the video.
   *
   * "Nothing to enter" has to mean nothing to press, too. The RA taps a
   * nametag colour, the dyad fills in, and the ~1 GB copy off the Research
   * Drive starts there — while they are still filling in the rest of the form
   * and doing the handover, rather than when they press Start. That head start
   * is most of why the section sits on the setup screen at all.
   *
   * Only in setup, and only once per dyad: searchedDyadRef stops a re-render
   * or a corrected typo from throwing away a copy that is nearly done.
   *
   * Debounced, because an RA typing 014 by hand produces "0", "01" and "014"
   * and the first two are other people's dyads. Without the wait all three
   * searches run, and the one that finishes last wins rather than the one that
   * asked last — which is how a station ends up holding dyad 1's conversation
   * while the screen says 014. Tapping a nametag colour sets the whole number
   * at once and only pays the delay.
   */
  useEffect(() => {
    if (stage !== "setup") return;
    const dyad = formData.dyadId.trim();
    if (!dyad || searchedDyadRef.current === dyad) return;
    const timer = setTimeout(() => startConversationSearch(dyad), 600);
    return () => clearTimeout(timer);
  }, [stage, formData.dyadId, startConversationSearch]);

  /**
   * The RA finished setting the station up. Next screen is the participant's —
   * or, from the second round on, straight back into the study, because the
   * participant is already signed in and sitting there.
   *
   * The files are named for the round: ratings_R2.csv, transitions_R2.csv. They
   * used to be ratings.csv and transitions.csv, one pair per folder, which
   * worked exactly as long as a folder meant one conversation. Round two with
   * the same partner would have appended a second participant-session onto the
   * first and neither could be separated afterwards — the failure the setup
   * screen's collision check exists to catch.
   */
  const handleSetupSubmit = async () => {
    try {
      const basePath = await invoke<string>("setup_rating_directory", {
        basePath: formData.saveFolder,
        dyadId: formData.dyadId,
        participantId: formData.participantId,
        partnerId: formData.partnerId,
        initials: formData.subjectInitials,
      });

      setSessionFolder(basePath);
      setDyadCsvFilePath(`${basePath}/${ratingsFileName(formData.round)}`);
      transitionsWriterRef.current = createTransitionsWriter(
        formData,
        `${basePath}/${transitionsFileName(formData.round)}`
      );
      // Round two and later: the participant never left, so the sign-in and
      // welcome screens would be asking a person who is already sitting there
      // to identify themselves again.
      if (rrParticipant) {
        // Their new conversation has to be found afresh — a new round is a new
        // dyad. Skipped when the search already ran for this dyad, so a copy
        // that is nearly done is not thrown away and restarted.
        if (searchedDyadRef.current !== formData.dyadId) {
          startConversationSearch(formData.dyadId);
        }
        beginRound();
        return;
      }
      setStage("signin");
    } catch (error) {
      console.error("Error setting up directory:", error);
      setCsvError(
        `Could not create the session folder in ${formData.saveFolder}. Is the Research Drive mounted? (${error})`
      );
    }
  };

  const handleParticipantSignIn = async (email: string) => {
    // Both check-in machines share the store file. The snapshot loaded at app
    // start goes stale the moment the other machine saves a sign-in, and
    // writing it back would erase that sign-in — so re-load from disk and
    // merge by email right before saving. A race window remains: two sign-ins
    // landing between each other's load and save can still drop one, but it
    // is now milliseconds wide instead of session-long. Alex, 2026-08-10.
    const onDisk = await loadData();
    const base = mergeData(onDisk, rrData ?? emptyData());
    const result = rrSignIn(base, email);
    if (result.isNew) {
      persistRr(result.data);
    } else {
      // Nothing to save, but keep the fresher merged copy locally.
      setRrData(result.data);
    }
    setRrParticipant(result.participant);
    setRrIsNew(result.isNew);
    setStage("welcome");

    writeProgress(result.participant.email, {
      stage: "checkin",
      done: 1,
      total: 1,
      detail: `Group ${result.participant.group}`,
      helpRequestedAt: null,
      helpResolvedAt: null,
    });
  };

  /**
   * Start the study on this round's conversation. Every round runs the same
   * three things — the post-conversation questions, the continuous rating, and
   * the short-video task — because all three are about the conversation that
   * just happened.
   */
  const beginRound = () => {
    setSelectedTask("postConversation");
    setTaskOrder(1);
    setStage("study");
    reportProgress("postconv", 0, 1, `Round ${formData.round} — post-conversation questions`);
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // The post-conversation questionnaire writes one row per item, in the order
  // presented. Item text goes in subTask (matching every other questionnaire in
  // the file) and the stable item key in emotion1, so analysis can join on the
  // key rather than on prose that may get reworded later.
  const handlePostConversationComplete = async (data?: ClassificationStepData) => {
    const write = transitionsWriterRef.current;
    const responses = (data?.responses ?? {}) as Record<string, number>;
    const order = (data?.order ?? []) as string[];
    const labels = (data?.labels ?? {}) as Record<string, string>;
    try {
      for (const key of order) {
        await write?.(
          "post_conversation",
          labels[key] ?? key,
          key,
          "",
          "",
          responses[key] ?? ""
        );
      }
    } catch (err) {
      console.error("Post-conversation write failed:", err);
      setCsvError(`Write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSelectedTask("dyad");
    // No block total yet: with one-minute blocks the count comes from the
    // recording's own length, which DyadTaskMain learns from the video element
    // and reports from its first block onwards.
    reportProgress("dyad", 0, 0, "Instructions");
  };

  const handleDyadTaskComplete = () => {
    setTaskOrder(2);
    setSelectedTask("classification");
    setCursorLocked(false);
    // Eight clips. The sharing page is no longer part of every round, and the
    // video task reports its own finer progress from here on — this is only
    // the first tick.
    reportProgress("video", 0, 8, "Instructions");
  };

  /**
   * The last per-round page is done. Close the round.
   *
   * Everything that could still be in memory goes to disk BEFORE the screen
   * changes — flushAll drains the continuous-rating sample buffer, which holds
   * up to ~15 seconds of the measurement (see utils/flushRegistry.ts). Randy's
   * concern was exactly this: "the app records data continuously… save a CSV
   * after every round". The round is only then written to the ledger, so a
   * ledger row is evidence the files are complete rather than a promise that
   * they will be.
   *
   * A failed flush does not block the screen. The RA needs to be able to move
   * the session on; the error banner says what happened and the rows are still
   * in the buffer for the next flush or the save-and-quit gate.
   */
  const handleRoundTasksComplete = async () => {
    setSelectedTask(null);
    try {
      await flushAll();
    } catch (err) {
      console.error("Flush at the end of the round failed:", err);
      setCsvError(`Some data could not be written at the end of round ${formData.round}: ${err}`);
    }

    const record: RoundRecord = {
      participantId: formData.participantId,
      participantColor: formData.participantColor,
      partnerId: formData.partnerId,
      partnerColor: formData.partnerColor,
      seat: formData.computer,
      dyadId: formData.dyadId,
      round: formData.round,
      date: formData.sessionDate,
      time: formData.sessionTime,
      folder: sessionFolder,
      ratingsFile: ratingsFileName(formData.round),
      transitionsFile: transitionsFileName(formData.round),
      completedAt: new Date().toISOString(),
      raName: formData.raName,
      groupId: formData.groupId,
    };
    try {
      await recordRound(record);
    } catch (err) {
      // The ledger is bookkeeping, not study data: the CSVs are already on
      // disk. Losing a row costs the next round's auto-numbering, which the RA
      // can correct on the setup screen, so it is logged rather than blocking.
      console.error("Round ledger write failed:", err);
    }

    setLastCompletedRound({
      participantId: formData.participantId,
      round: formData.round,
    });
    setStage("roundComplete");
    reportProgress("done", 1, 1, `Round ${formData.round} complete`);
  };

  /**
   * The RA says there is another conversation. Keep the participant, the RA
   * name, the drive and the machine settings; clear everything that belongs to
   * the round that just ended.
   *
   * The conversation video is reset to idle rather than re-fetched here: the
   * next round's recording may not have been filed yet (the participants have
   * only just walked back in), and the setup screen is where an RA finds or
   * waits for it — with the manual picker one click away, as always.
   */
  const handleNextRound = () => {
    setFormData((prev) => ({
      ...prev,
      round: prev.round + 1,
      // The partner changes; who is sitting here does not.
      partnerId: "",
      partnerColor: "",
      dyadId: "",
      sessionTime: nowHHMM(),
      sessionDate: todayISO(),
    }));
    setSelectedTask(null);
    setDyadCsvFilePath("");
    setSessionFolder("");
    transitionsWriterRef.current = null;
    setPrep({ status: "idle" });
    searchedDyadRef.current = "";
    setStage("setup");
  };

  /**
   * No more rounds today.
   *
   * Nothing is left to ask. Everything a participant does is about one
   * conversation and was finished with that round — including the video-sharing
   * page, which lives at the end of the short-video task where Ben pointed out
   * it belongs. So this goes straight to the closing screen.
   */
  const handleFinishSession = () => {
    setSelectedTask(null);
    setSessionDone(true);
    reportProgress("done", 1, 1, "Session complete");
    void flushAll().catch((err) =>
      console.error("Flush at the end of the session failed:", err)
    );
  };

  const handleCsvError = (msg: string) => {
    setCsvError(msg);
  };

  /**
   * Whether the colour strip belongs on screen right now.
   *
   * Participant-facing screens only, and never during the continuous rating:
   * the pointer is the measurement there, and a line of text at the bottom of
   * the screen is an invitation to move the cursor down to read it. Same rule
   * as the help button above.
   */
  const showSessionStrip =
    (stage === "study" || stage === "roundComplete") && !cursorLocked;

  // The wrapper below is w-full, not w-screen. #root is the scroll container, so
  // on any page tall enough to scroll, 100vw is wider than the space left beside
  // the vertical scrollbar and the app picks up a horizontal scrollbar too.

  return (
    <div className="w-full bg-black cursor-auto">
      <AdminQuitModal
        isOpen={showAdminQuit}
        onCancel={() => setShowAdminQuit(false)}
        onConfirm={handleConfirmQuit}
        onLeaveMode={() => {
          setShowAdminQuit(false);
          void handleLeaveMode();
        }}
      />

      {csvError && (
        <ErrorBanner message={csvError} onDismiss={() => setCsvError(null)} />
      )}

      {/* Participant help signal. Hidden during the continuous rating, where
          moving the pointer to a corner would be recorded as a slider value. */}
      {stage === "study" && rrParticipant && !cursorLocked && (
        <HelpButton
          onRequestHelp={handleRequestHelp}
          onCancelHelp={handleCancelHelp}
          pending={helpPending}
        />
      )}

      {showSessionStrip && (
        <SessionStrip
          participantColor={formData.participantColor}
          partnerColor={formData.partnerColor}
          seat={formData.computer}
          round={formData.round}
        />
      )}

      {stage === "setup" ? (
        <StationSetup
          formData={formData}
          onRoundChange={(round) =>
            setFormData((prev) => ({ ...prev, round: Math.max(1, round) }))
          }
          lastCompletedRound={lastCompletedRound}
          settings={settings}
          remote={remote}
          video={{
            dyadId: formData.dyadId,
            onFind: () => startConversationSearch(formData.dyadId),
            prep,
            onUseVideo: (video) =>
              prepareVideo(video, prep.status === "choose" ? prep.videos : [video]),
            onUseFile: prepareFile,
          }}
          onSettingsChange={handleSettingsChange}
          onDriveChange={handleDriveChange}
          onChange={handleFormChange}
          onSubmit={() => void handleSetupSubmit()}
          onDashboard={() => {
            setAdminReturn("setup");
            setStage("admin");
          }}
          onLeaveMode={() => void handleLeaveMode()}
        />
      ) : stage === "admin" ? (
        <AdminDashboard
          data={rrData ?? { version: 1, groupSize: 5, participants: [], meetings: {} }}
          onChange={persistRr}
          onRefresh={setRrData}
          onExit={() => setStage(adminReturn)}
          onLeaveMode={() => void handleLeaveMode()}
          onError={setCsvError}
        />
      ) : stage === "signin" ? (
        <SignIn
          onParticipant={handleParticipantSignIn}
          onAdmin={() => {
            setAdminReturn("signin");
            setStage("admin");
          }}
        />
      ) : stage === "welcome" && rrData && rrParticipant ? (
        <Welcome
          data={rrData}
          participant={rrParticipant}
          isNew={rrIsNew}
          onContinue={beginRound}
        />
      ) : sessionDone ? (
        <div className="h-screen w-full flex flex-col items-center justify-center px-8">
          <p className="text-white text-2xl text-center max-w-2xl">
            Please alert your researcher that you are finished.
          </p>
          {/* For the RA who comes over, not the participant: proof the session
              landed somewhere, and where. A session whose data folder is not
              on the Research Drive is worth catching while everyone is still
              in the room. */}
          <p className="text-gray-600 text-xs text-center mt-16 font-mono break-all max-w-3xl">
            {sessionFolder}
          </p>
        </div>
      ) : stage === "roundComplete" ? (
        <RoundComplete
          round={formData.round}
          folder={sessionFolder}
          ratingsFile={ratingsFileName(formData.round)}
          transitionsFile={transitionsFileName(formData.round)}
          onNextRound={handleNextRound}
          onFinishSession={handleFinishSession}
        />
      ) : selectedTask === "postConversation" ? (
        <PostConversation onContinue={handlePostConversationComplete} />
      ) : selectedTask === "dyad" ? (
        <DyadTaskMain
          formData={formData}
          csvFilePath={dyadCsvFilePath}
          taskOrder={taskOrder}
          conversation={{
            prep,
            onUseVideo: (video) =>
              prepareVideo(
                video,
                prep.status === "idle" || prep.status === "finding" ? [video] : prep.videos
              ),
            onRetry: () => startConversationSearch(formData.dyadId),
          }}
          onComplete={handleDyadTaskComplete}
          onCsvError={handleCsvError}
          onProgress={(done, total, detail) => reportProgress("dyad", done, total, detail)}
          onCursorLock={setCursorLocked}
        />
      ) : selectedTask === "classification" && transitionsWriterRef.current ? (
        <ClassificationTaskMain
          round={formData.round}
          writeRow={transitionsWriterRef.current}
          onComplete={() => void handleRoundTasksComplete()}
          onCsvError={handleCsvError}
          onProgress={(stage, done, total, detail) =>
            reportProgress(stage, done, total, detail)
          }
        />
      ) : (
        <div className="h-screen w-full flex items-center justify-center">
          <p className="text-white text-2xl">Loading…</p>
        </div>
      )}
    </div>
  );
}

export default App;
