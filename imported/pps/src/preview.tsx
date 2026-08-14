// Dev-only screen preview: http://localhost:1420/preview.html
//
// Jumps straight to any screen of the video task without running a whole
// session, so a screen can be shown to Randy, or checked after an edit, in a
// couple of seconds instead of forty minutes. Rows that would be written to
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
import CombinedRatingPage from "./video-task/CombinedRatingPage";
import VideoSelectionPage from "./video-task/VideoSelectionPage";
import PostConversation from "./classification-task/PostConversation";
import RatingOverlay from "./dyad-task/RatingOverlay";
import TransitionScreen from "./dyad-task/TransitionScreen";
import AdminDashboard from "./roundrobin/AdminDashboard";
import HelpButton from "./components/HelpButton";
import { VIDEO_SETS, findVideo, resolveVideoSrc } from "./video-task/videos";
import { emptyData } from "./roundrobin/store";
import type { RRData } from "./roundrobin/store";

const SCREENS = [
  "post-conversation questions",
  "post-video writing + rating",
  "perspective screen",
  "video task (whole thing)",
  "watch page",
  "rating page",
  "combined rating page",
  "selection page",
  "dashboard",
] as const;

type Screen = (typeof SCREENS)[number];

const SET = VIDEO_SETS[0];
const srcFor = (id: string) => resolveVideoSrc(id, null);

function Preview() {
  const [screen, setScreen] = useState<Screen>("video task (whole thing)");
  const [rows, setRows] = useState<string[]>([]);
  const [rrData, setRrData] = useState<RRData>(emptyData());
  const [ratingText, setRatingText] = useState("");
  const [ratingScale, setRatingScale] = useState<number | undefined>(undefined);

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

      {screen === "perspective screen" && (
        <div className="relative h-[80vh]">
          <TransitionScreen
            ratingTarget="partner"
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
          targetReminder="YOUR PARTNER"
          alreadyWatchedEarlier={false}
          requireWatch
          onWatched={(stats) => void writeRow("preview", clip.id, "", "watch", "", stats.plays)}
          onContinue={() => window.alert("Continue")}
        />
      )}

      {screen === "rating page" && (
        <VideoRatingPage
          videoId={clip.id}
          emotions={clip.emotions}
          src={srcFor(clip.id)}
          targetPhrase="your partner"
          targetCaps="YOUR PARTNER"
          isSelf={false}
          positionLabel="Video 1 of 8"
          onSubmit={(ratings) => {
            for (const r of ratings) {
              void writeRow("preview", clip.id, r.emotion, "intensity", "your partner", r.intensity);
            }
          }}
        />
      )}

      {screen === "combined rating page" && (
        <CombinedRatingPage
          videoId={clip.id}
          emotions={clip.emotions}
          people={["yourself", "your partner", "an average UW-Madison student"]}
          src={srcFor(clip.id)}
          positionLabel="Video 1 of 8"
          onSubmit={(ratings) => {
            for (const r of ratings) {
              void writeRow("preview", clip.id, r.emotion, "intensity", r.person, r.intensity);
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
            void writeRow("preview", "for_average_student", "", "", "", result.forAverage.join(";"));
          }}
        />
      )}

      {screen === "dashboard" && (
        <AdminDashboard
          data={rrData}
          onChange={setRrData}
          onRefresh={setRrData}
          onExit={() => window.alert("Sign out")}
        />
      )}

      {screen !== "dashboard" && (
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
