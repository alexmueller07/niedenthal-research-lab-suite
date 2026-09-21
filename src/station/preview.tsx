// Dev-only screen preview: http://localhost:1440/preview.html
//
// Jumps straight to any screen of the study without running a whole session, so
// a screen can be shown to Randy, or checked after an edit, in a couple of
// seconds instead of forty minutes. Rows that would be written to
// transitions.csv are printed on the page instead.
//
// Vite only builds index.html, so this file and preview.html never reach the
// installer. Nothing in the study imports it.

import { StrictMode, useState } from "react";
import ReactDOM from "react-dom/client";
import "./App.css";

import VideoTaskMain from "./video-task/VideoTaskMain";
import VideoWatchPage from "./video-task/VideoWatchPage";
import VideoRatingPage from "./video-task/VideoRatingPage";
import VideoSelectionPage from "./video-task/VideoSelectionPage";
import PostConversation from "./classification-task/PostConversation";
import PartnerSliders from "./classification-task/PartnerSliders";
import PartnerHistory from "./classification-task/PartnerHistory";
import Instructions from "./dyad-task/Instructions";
import RoundComplete from "./rounds/RoundComplete";
import SessionStrip from "./components/SessionStrip";
import RatingOverlay from "./dyad-task/RatingOverlay";
import TransitionScreen from "./dyad-task/TransitionScreen";
import PerspectiveNotice from "./components/PerspectiveNotice";
import AdminDashboard from "./roundrobin/AdminDashboard";
import StationSetup from "./setup/StationSetup";
import HelpButton from "./components/HelpButton";
import { VIDEO_SETS, assignSet, findVideo, resolveVideoSrc } from "./video-task/videos";
import { emptyData } from "./roundrobin/store";
import type { RRData } from "./roundrobin/store";
import { EMPTY_SETTINGS } from "./utils/settings";
import type { FormData } from "./App";

const SCREENS = [
  "station setup",
  "round complete",
  "slider instructions",
  "post-conversation questions",
  "post-video writing + rating",
  "slider perspective screen",
  "video perspective screen",
  "video task (whole thing)",
  "watch page",
  "rating page — partner",
  "rating page — self",
  "partner ratings",
  "partner history",
  "selection page",
  "dashboard",
] as const;

// The conversation-rating instructions, copied from DyadTaskMain so the screen
// can be shown on its own. Kept here deliberately rather than exported from the
// task: this panel never ships (vite.config.ts builds no entry for it), and an
// export that only the preview uses is an export the task has to keep working.
const DYAD_INSTRUCTIONS_PREVIEW = [
  "Before we begin: please check that the computer's volume is at a comfortable level. You will hear the audio from your conversation. Ask your researcher if you would like help adjusting it.",
  "In this part of the study, you will watch the video recording of the conversation you just had.",
  "We are interested in two things:\n\t1. How YOU were feeling during the conversation.\n\t2. How YOUR PARTNER was feeling during the conversation.",
  "The video is split into parts. Before each part, the screen will tell you whether to focus on YOUR OWN feelings or YOUR PARTNER'S feelings, and a reminder stays in the corner of the screen while you watch.",
  "As the video plays, continuously move the slider to indicate how positive or negative YOU or YOUR PARTNER felt at that moment during the conversation.",
  "At certain points, you will be asked to write a short response and make ratings about how you or your partner felt during the part of the conversation you just watched.",
];

type Screen = (typeof SCREENS)[number];

const SET = VIDEO_SETS[0];
const srcFor = (id: string) => resolveVideoSrc(id, null);

const BLANK_FORM: FormData = {
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
};

function Preview() {
  const [screen, setScreen] = useState<Screen>("video task (whole thing)");
  const [rows, setRows] = useState<string[]>([]);
  const [rrData, setRrData] = useState<RRData>(emptyData());
  const [ratingText, setRatingText] = useState("");
  const [ratingScale, setRatingScale] = useState<number | undefined>(undefined);
  const [form, setForm] = useState<FormData>(BLANK_FORM);
  const [instructionIndex, setInstructionIndex] = useState(0);
  // Which round the preview pretends to be, which is what picks the clip
  // group — the whole point of a preview is being able to look at group 4
  // without doing three conversations first.
  const [previewRound, setPreviewRound] = useState(1);

  const writeRow = async (
    ratingTask: string,
    subTask: string,
    emotion1: string,
    emotion2: string,
    ratingPerson: string,
    response: number | string
  ) => {
    setRows((prev) => [
      `${ratingTask} | ${subTask} | ${emotion1} | ${emotion2} | ${ratingPerson} | ${response}`,
      ...prev,
    ]);
  };

  const clip = findVideo(SET.videoIds[0]);
  const emotions = clip.emotions;

  return (
    <div className="bg-black min-h-screen">
      <div className="sticky top-0 z-50 bg-gray-900 border-b border-white px-6 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-yellow-400 text-sm font-bold">DEV PREVIEW</span>
        {SCREENS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              if (s === screen) return; // keep the rows already written
              setRows([]);
              setScreen(s);
            }}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              screen === s
                ? "bg-white text-black border-white"
                : "bg-black text-white border-gray-500 hover:border-white"
            }`}
          >
            {s}
          </button>
        ))}
        {/* The round picks the clip group, so the preview needs it to be able
            to show group 4 without doing three conversations first. */}
        <span className="text-gray-400 text-sm ml-auto flex items-center gap-2">
          Round
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setPreviewRound(r)}
              className={`px-2 py-0.5 border text-xs transition-colors ${
                previewRound === r
                  ? "bg-white text-black border-white"
                  : "bg-black text-white border-gray-500 hover:border-white"
              }`}
            >
              R{r}
            </button>
          ))}
          <span className="ml-3">{rows.length} rows written</span>
        </span>
      </div>

      {screen === "station setup" && (
        <StationSetup
          formData={form}
          onRoundChange={(round) => setForm((prev) => ({ ...prev, round }))}
          lastCompletedRound={null}
          settings={EMPTY_SETTINGS}
          remote={{
            roundRobinUrl: "https://example.invalid",
            researchDriveRoot: null,
            driveIsShared: false,
            recentDriveRoots: [],
          }}
          roster={[]}
          video={{
            canSearch: false,
            email: "",
            onEmailChange: () => {},
            onFind: () => {},
            prep: { status: "idle" },
            onUseClip: () => {},
            onUseFile: () => {},
          }}
          onSettingsChange={() => {}}
          onDriveChange={async () => {}}
          onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onSubmit={() => window.alert("Start session")}
          onDashboard={() => setScreen("dashboard")}
          onLeaveMode={() => window.alert("Back to the mode chooser")}
        />
      )}

      {screen === "round complete" && (
        <RoundComplete
          round={2}
          folder="R:\niedenthal\pps-data\51_101_102_AB"
          ratingsFile="ratings_R2.csv"
          transitionsFile="transitions_R2.csv"
          onNextRound={() => window.alert("Log the next round")}
          onFinishSession={() => window.alert("Finish the session")}
        />
      )}

      {screen === "slider instructions" && (
        <div className="h-[calc(100vh-170px)]">
          <Instructions
            instructionIndex={instructionIndex}
            instructions={DYAD_INSTRUCTIONS_PREVIEW}
            groupSize={DYAD_INSTRUCTIONS_PREVIEW.length}
            onBack={() => setInstructionIndex((i) => Math.max(0, i - 1))}
            onContinue={() =>
              setInstructionIndex((i) =>
                Math.min(DYAD_INSTRUCTIONS_PREVIEW.length - 1, i + 1)
              )
            }
          />
        </div>
      )}

      {screen === "partner ratings" && (
        <PartnerSliders
          onContinue={(data) =>
            void writeRow(
              "partner_sliders",
              "all",
              "",
              "",
              "",
              JSON.stringify(data?.sliderSelections ?? {})
            )
          }
        />
      )}

      {screen === "partner history" && (
        <PartnerHistory
          onContinue={(data) =>
            void writeRow(
              "partner_history",
              "met",
              "",
              "",
              "",
              data?.partnerHistory ? "Yes" : "No"
            )
          }
        />
      )}

      {screen === "post-conversation questions" && (
        <PostConversation
          onContinue={(data) => {
            const responses = (data?.responses ?? {}) as Record<string, number>;
            for (const key of (data?.order ?? []) as string[]) {
              void writeRow("post_conversation", key, "", "", "", responses[key] ?? "");
            }
          }}
        />
      )}

      {screen === "post-video writing + rating" && (
        // Boxed into the same fixed-height, overflow-hidden parent the dyad task
        // gives it, so the preview reproduces the real clipping conditions.
        <div className="relative h-[calc(100vh-60px)] overflow-hidden">
          <RatingOverlay
            currentRatingTarget="self"
            textInput={ratingText}
            setTextInput={setRatingText}
            numberScale={ratingScale}
            setNumberScale={setRatingScale}
            attemptedSubmit={false}
            isFinal
            onSubmit={() =>
              void writeRow("preview", "elicitation", "", "", "self", ratingScale ?? "")
            }
            onConfirmIncomplete={() => {}}
            onDismissIncomplete={() => {}}
          />
        </div>
      )}

      {screen === "slider perspective screen" && (
        <div className="relative h-[80vh]">
          <TransitionScreen
            ratingTarget="partner"
            onContinue={() => window.alert("Continue")}
          />
        </div>
      )}

      {screen === "video perspective screen" && (
        <div className="relative h-[80vh]">
          <PerspectiveNotice
            headline={
              <>
                You will now be reporting how{" "}
                <span className="font-bold underline">YOUR PARTNER</span> would feel.
              </>
            }
            onContinue={() => window.alert("Continue")}
          />
        </div>
      )}

      {screen === "video task (whole thing)" && (
        <VideoTaskMain
          round={previewRound}
          writeRow={writeRow}
          onComplete={() => window.alert("Video task complete")}
        />
      )}

      {screen === "watch page" && (
        <VideoWatchPage
          src={srcFor(clip.id)}
          positionLabel="Video 1 of 8"
          onWatched={(stats) => void writeRow("preview", clip.id, "", "watch", "", stats.plays)}
          onContinue={() => window.alert("Continue")}
        />
      )}

      {(screen === "rating page — partner" || screen === "rating page — self") && (
        <VideoRatingPage
          key={screen}
          videoId={clip.id}
          emotions={emotions}
          src={srcFor(clip.id)}
          target={screen === "rating page — self" ? "self" : "partner"}
          positionLabel="Video 1 of 8"
          onSubmit={(result) => {
            const person = screen === "rating page — self" ? "yourself" : "your partner";
            for (const r of result.ratings) {
              void writeRow("preview", clip.id, r.emotion, "intensity", person, r.intensity);
            }
            if (result.confidence !== "") {
              void writeRow("preview", clip.id, "", "confidence", person, result.confidence);
            }
          }}
        />
      )}

      {screen === "selection page" && (
        <VideoSelectionPage
          videoIds={assignSet(previewRound).videoIds}
          srcFor={srcFor}
          onSubmit={(result) => {
            void writeRow("preview", "for_partner", "", "", "", result.forPartner.join(";"));
            void writeRow("preview", "for_self", "", "", "", result.forSelf.join(";"));
            void writeRow("preview", "column_order", "", "", "", result.columnOrder.join(";"));
          }}
        />
      )}

      {screen === "dashboard" && (
        <AdminDashboard
          data={rrData}
          onChange={setRrData}
          onRefresh={setRrData}
          onExit={() => window.alert("Back to setup")}
          onLeaveMode={() => window.alert("Back to the mode chooser")}
        />
      )}

      {screen !== "dashboard" && screen !== "station setup" && (
        <>
          <HelpButton onRequestHelp={() => {}} onCancelHelp={() => {}} pending={false} />
          <SessionStrip
            participantColor="green"
            partnerColor="orange"
            seat="Left"
            round={2}
          />
        </>
      )}

      {rows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 max-h-48 overflow-auto bg-gray-900 border-t border-gray-600 px-6 py-3 z-30">
          <p className="text-gray-400 text-xs mb-1">
            rows that would go to transitions.csv (newest first)
          </p>
          {rows.map((row, i) => (
            <p key={i} className="text-green-300 text-xs font-mono">
              {row}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
