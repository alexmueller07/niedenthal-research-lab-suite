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
import RatingOverlay from "./dyad-task/RatingOverlay";
import TransitionScreen from "./dyad-task/TransitionScreen";
import PerspectiveNotice from "./components/PerspectiveNotice";
import AdminDashboard from "./roundrobin/AdminDashboard";
import StationSetup from "./setup/StationSetup";
import HelpButton from "./components/HelpButton";
import { VIDEO_SETS, findVideo, resolveVideoSrc } from "./video-task/videos";
import { emptyData } from "./roundrobin/store";
import type { RRData } from "./roundrobin/store";
import { EMPTY_SETTINGS } from "./utils/settings";
import type { FormData } from "./App";

const SCREENS = [
  "station setup",
  "post-conversation questions",
  "post-video writing + rating",
  "slider perspective screen",
  "video perspective screen",
  "video task (whole thing)",
  "watch page",
  "rating page — partner",
  "rating page — self",
  "selection page",
  "dashboard",
] as const;

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
};

function Preview() {
  const [screen, setScreen] = useState<Screen>("video task (whole thing)");
  const [rows, setRows] = useState<string[]>([]);
  const [rrData, setRrData] = useState<RRData>(emptyData());
  const [ratingText, setRatingText] = useState("");
  const [ratingScale, setRatingScale] = useState<number | undefined>(undefined);
  const [form, setForm] = useState<FormData>(BLANK_FORM);

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
        <span className="text-gray-400 text-sm ml-auto">{rows.length} rows written</span>
      </div>

      {screen === "station setup" && (
        <StationSetup
          formData={form}
          settings={EMPTY_SETTINGS}
          remote={{
            roundRobinUrl: "https://example.invalid",
            researchDriveRoot: null,
            driveIsShared: false,
            recentDriveRoots: [],
          }}
          onSettingsChange={() => {}}
          onDriveChange={async () => {}}
          onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onSubmit={() => window.alert("Start session")}
          onDashboard={() => setScreen("dashboard")}
          onLeaveMode={() => window.alert("Back to the mode chooser")}
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
          dyadId="PREVIEW"
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
          videoIds={SET.videoIds}
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
        <HelpButton onRequestHelp={() => {}} onCancelHelp={() => {}} pending={false} />
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
