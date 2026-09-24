import { useEffect, useRef, useState } from "react";

import { describeVideo, hasTauri, videoThumbnailUrl } from "../remote/api";
import type { DyadVideo } from "../remote/api";
import type { ConversationPrep } from "../App";

// Choosing and confirming the conversation recording, on the RA's screen.
//
// This used to happen mid-task: the participant reached the rating task, and
// only then did the app go looking for their video — with the RA long gone. If
// it found the wrong one, or more than one, the first person to notice was the
// participant, sitting in front of a conversation that was not theirs. Randy
// asked for the choice to move to setup (2026-08-29), which is the last moment
// anyone who can fix it is still standing at the machine.
//
// What it is keyed on changed on 2026-09-24. It used to ask the RA for the
// participant's email address and hand that to Round Robin, which then had to
// have a session for today, a generated rotation, a claimed room, this person
// on the schedule, and the address they would sign in with. Five things, any
// of which could be wrong while the recording sat on the drive three feet
// away — and the lab's test sessions kept landing on exactly that.
//
// It is now keyed on the dyad number, which this screen already has (off the
// nametag colour, or typed) and which the recording room already typed. There
// is nothing to enter here at all.
//
// The frame is the point of the whole section. A filename tells an RA little
// about which conversation it holds; two seconds of picture tells them
// immediately. It is read straight off the share before any copying starts —
// see video_thumbnail in station/remote.rs.
//
// Every state here is skippable. The lab's standing rule is that the pipeline
// must never block a session: an RA who ignores this section entirely still
// gets the manual file picker inside the task.

interface ConversationVideoProps {
  /** The dyad this station is set to. "" before a colour is tapped. */
  dyadId: string;
  /** Runs the lookup again — the recording room may still have been copying. */
  onFind: () => void;
  prep: ConversationPrep;
  onUseVideo: (video: DyadVideo) => void;
  /** A file the RA browsed to instead. */
  onUseFile: (path: string) => void;
}

/** The frame itself, with its own loading and failure states. */
function Frame({ path, caption }: { path: string | null; caption: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held so the effect's cleanup revokes the URL it created rather than
  // whichever one is current by the time it runs.
  const createdRef = useRef<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!path || !hasTauri()) return;
    let live = true;
    void videoThumbnailUrl(path)
      .then((next) => {
        if (!live) {
          URL.revokeObjectURL(next);
          return;
        }
        createdRef.current = next;
        setUrl(next);
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
      if (createdRef.current) {
        URL.revokeObjectURL(createdRef.current);
        createdRef.current = null;
      }
    };
  }, [path]);

  if (!path) return null;

  return (
    <div className="flex gap-4 items-start">
      <div className="w-60 shrink-0 aspect-video border border-gray-700 rounded bg-gray-900 flex items-center justify-center overflow-hidden">
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : error ? (
          <span className="text-red-400 text-xs px-3 text-center">No preview</span>
        ) : (
          <span className="text-gray-500 text-xs">Reading a frame…</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-white text-base break-words">{caption}</p>
        <p className="text-gray-500 text-xs mt-1 font-mono break-all">{path}</p>
        {error && <p className="text-yellow-400 text-xs mt-2">{error}</p>}
      </div>
    </div>
  );
}

export default function ConversationVideo({
  dyadId,
  onFind,
  prep,
  onUseVideo,
  onUseFile,
}: ConversationVideoProps) {
  const [browseError, setBrowseError] = useState<string | null>(null);

  // Which recording the frame should show. In "choose" that is the newest one
  // until the RA taps another; everywhere else there is only one candidate.
  const [previewing, setPreviewing] = useState<DyadVideo | null>(null);
  const candidate =
    previewing ??
    (prep.status === "choose"
      ? prep.recommended
      : prep.status === "copying" || prep.status === "ready"
        ? prep.video
        : null);

  const browse = async () => {
    setBrowseError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        title: "The conversation recording",
        filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "m4v"] }],
      });
      if (typeof picked === "string") onUseFile(picked);
    } catch (err) {
      setBrowseError(`File picker failed: ${err}`);
    }
  };

  const skipLink = (
    <button
      type="button"
      onClick={() => void browse()}
      className="text-gray-400 text-sm underline hover:text-white"
    >
      Browse for the file instead
    </button>
  );

  return (
    <section className="border border-gray-700 rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-white text-xl font-bold mb-1">Conversation video</h2>
          <p className="text-gray-400 text-sm">
            {dyadId
              ? `Found by dyad ${dyadId} — the same number the recording room typed. Nothing to enter.`
              : "Pick who is sitting here above, and the video for their dyad is found automatically."}
          </p>
        </div>
        {dyadId && (
          <button
            type="button"
            onClick={onFind}
            disabled={prep.status === "finding" || prep.status === "copying"}
            className="shrink-0 px-4 py-2 text-white text-sm border border-gray-600 rounded-lg hover:border-white transition-colors disabled:opacity-40"
          >
            {prep.status === "finding" ? "Looking…" : "Look again"}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {prep.status === "finding" && (
          <p className="text-gray-400 text-sm">
            Looking on the Research Drive for dyad {dyadId}…
          </p>
        )}

        {prep.status === "choose" && (
          <>
            <p className="text-gray-400 text-sm">
              {prep.videos.length} recordings filed under dyad {dyadId}. Which one
              gets rated is a protocol decision — the newest is preselected.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                prep.recommended,
                ...prep.videos.filter(
                  (v) => v.recordingId !== prep.recommended.recordingId
                ),
              ].map((v) => {
                const showing = (candidate?.recordingId ?? "") === v.recordingId;
                return (
                  <button
                    key={v.recordingId}
                    type="button"
                    onClick={() => setPreviewing(v)}
                    className={`px-3 py-2 border rounded-lg text-sm transition-colors ${
                      showing
                        ? "border-white bg-gray-800 text-white"
                        : "border-gray-600 text-gray-300 hover:border-gray-300"
                    }`}
                  >
                    {describeVideo(v)}
                    {v.recordingId === prep.recommended.recordingId && (
                      <span className="ml-2 text-gray-500 text-xs">newest</span>
                    )}
                  </button>
                );
              })}
            </div>
            <Frame
              path={candidate?.path ?? null}
              caption={candidate ? describeVideo(candidate) : ""}
            />
            <button
              type="button"
              disabled={!candidate}
              onClick={() => candidate && onUseVideo(candidate)}
              className="px-5 py-2.5 text-black bg-white rounded-lg font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              Use this one
            </button>
          </>
        )}

        {prep.status === "copying" && (
          <>
            <Frame
              path={prep.video?.path ?? null}
              caption={`Copying — ${prep.video ? describeVideo(prep.video) : "the recording"}`}
            />
            <div className="w-full h-2 border border-gray-600 rounded">
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
            <p className="text-gray-400 text-xs">
              {prep.totalBytes > 0
                ? `${Math.round(prep.copiedBytes / 1048576)} MB of ${Math.round(
                    prep.totalBytes / 1048576
                  )} MB — it finishes on its own, you can hand over now.`
                : "Starting…"}
            </p>
          </>
        )}

        {prep.status === "ready" && (
          <>
            <Frame
              path={prep.video?.path ?? prep.localPath}
              caption={
                prep.video
                  ? `Ready — ${describeVideo(prep.video)}`
                  : "Ready — chosen by hand"
              }
            />
            <p className="text-green-400 text-sm">
              On this computer. The rating task will open it without asking.
            </p>
          </>
        )}

        {prep.status === "failed" && (
          <div className="border border-yellow-600 rounded-lg p-4">
            <p className="text-yellow-400 text-sm font-semibold">
              No video found for dyad {dyadId}.
            </p>
            <p className="text-gray-300 text-sm mt-1">{prep.message}</p>
            <p className="text-gray-400 text-sm mt-2">
              Not a reason to hold the session up — start it, and the rating task
              will ask again later. Or point at the file now.
            </p>
          </div>
        )}

        {browseError && <p className="text-red-400 text-sm">{browseError}</p>}
        {prep.status !== "copying" && skipLink}
      </div>
    </section>
  );
}
