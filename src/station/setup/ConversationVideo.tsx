import { useEffect, useMemo, useRef, useState } from "react";

import { describeClip, hasTauri, resolveClipPath, videoThumbnailUrl } from "../remote/api";
import type { RemoteClip } from "../remote/api";
import type { ConversationPrep } from "../App";
import type { RRParticipant } from "../roundrobin/store";

// Choosing and confirming the conversation recording, on the RA's screen.
//
// This used to happen mid-task: the participant reached the rating task, and
// only then did the app go looking for their video — with the RA long gone. If
// it found the wrong one, or more than one, the first person to notice was the
// participant, sitting in front of a conversation that was not theirs. Randy
// asked for the choice to move to setup (2026-08-29), which is the last moment
// anyone who can fix it is still standing at the machine.
//
// The lookup is keyed on the participant's email, which at this point in the
// session nobody has typed yet — the participant signs in after the handover.
// So the RA supplies it here instead, picking from the addresses this station
// has already seen rather than typing one out. A participant who has never sat
// at a lab machine is on no roster, so the field takes a typed address too.
//
// The frame is the point of the whole section. A filename tells an RA nothing
// about which conversation it holds; two seconds of picture tells them
// immediately. It is read straight off the share before any copying starts —
// see video_thumbnail in station/remote.rs.
//
// Every state here is skippable. The lab's standing rule is that the pipeline
// must never block a session: an RA who ignores this section entirely still
// gets the automatic fetch at sign-in and the manual picker inside the task.

interface ConversationVideoProps {
  /** False when this machine has no Round Robin server to ask. */
  canSearch: boolean;
  /** Everyone this station knows about, for the email suggestions. */
  roster: RRParticipant[];
  /** Whose conversation the RA said this is, if they have said. */
  email: string;
  onEmailChange: (email: string) => void;
  /** Starts the Round Robin lookup for the address above. */
  onFind: () => void;
  prep: ConversationPrep;
  onUseClip: (clip: RemoteClip) => void;
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
  canSearch,
  roster,
  email,
  onEmailChange,
  onFind,
  prep,
  onUseClip,
  onUseFile,
}: ConversationVideoProps) {
  /** Path on the share for the clip currently being offered, for the frame. */
  const [clipPath, setClipPath] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // Which recording the frame should show. In "choose" that is the newest one
  // until the RA taps another; everywhere else there is only one candidate.
  const [previewing, setPreviewing] = useState<RemoteClip | null>(null);
  const candidate =
    previewing ??
    (prep.status === "choose"
      ? prep.recommended
      : prep.status === "copying" || prep.status === "ready"
        ? prep.clip
        : null);

  useEffect(() => {
    setClipPath(null);
    const key = candidate?.storageKey;
    if (!key || !hasTauri()) return;
    let live = true;
    void resolveClipPath(key)
      .then((path) => {
        if (live) setClipPath(path);
      })
      // A path we cannot resolve costs the preview, nothing else — the copy
      // resolves it again on its own.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [candidate?.storageKey]);

  const suggestions = useMemo(() => {
    const typed = email.trim().toLowerCase();
    return roster
      .map((p) => p.email)
      .filter((address) => address !== "admin@admin")
      .filter((address) => typed === "" || address.toLowerCase().includes(typed))
      .sort()
      .slice(0, 6);
  }, [roster, email]);

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
      <h2 className="text-white text-xl font-bold mb-1">Conversation video</h2>
      <p className="text-gray-400 text-sm mb-4">
        Optional, and worth doing. Confirming the recording here is the last
        point at which someone who can fix a mistake is still at this computer —
        and the copy off the Research Drive gets a head start on the
        questionnaires.
      </p>

      {/* ---- who is sitting here, as the lookup understands it ---- */}
      <label className="block text-white text-base mb-2">
        Participant&rsquo;s email
      </label>
      <div className="flex space-x-2">
        <input
          autoComplete="off"
          type="text"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onFind();
            }
          }}
          placeholder="the address they will sign in with"
          spellCheck={false}
          className="flex-1 p-3 text-white bg-gray-800 border border-white rounded-lg focus:outline-none focus:border-blue-400"
        />
        <button
          type="button"
          disabled={!canSearch || email.trim() === ""}
          onClick={onFind}
          className="px-4 py-3 text-black bg-white rounded-lg font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          Find video
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {suggestions.map((address) => (
            <button
              key={address}
              type="button"
              onClick={() => onEmailChange(address)}
              className="px-3 py-1.5 border border-gray-600 rounded-lg text-gray-300 text-xs hover:border-white hover:text-white transition-colors"
            >
              {address}
            </button>
          ))}
        </div>
      )}

      {canSearch ? (
        <p className="text-gray-500 text-xs mt-2">
          The participant signs in with this address after the handover. If they
          sign in with a different one, the station follows theirs — this only
          starts the search early.
        </p>
      ) : (
        <p className="text-yellow-400 text-xs mt-2">
          This computer has no Round Robin server set, so there is nothing to
          look the recording up in. Point at the file directly instead, or set
          the server on the researcher dashboard.
        </p>
      )}

      {/* ---- what the lookup found ---- */}
      <div className="mt-5 space-y-4">
        {prep.status === "finding" && (
          <p className="text-gray-400 text-sm">
            Asking Round Robin which recording belongs to this participant…
          </p>
        )}

        {prep.status === "choose" && (
          <>
            <p className="text-gray-400 text-sm">
              {prep.clips.length} recordings on file. Which one gets rated is a
              protocol decision — the newest is preselected.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                prep.recommended,
                ...prep.clips.filter(
                  (c) => c.recordingId !== prep.recommended.recordingId
                ),
              ].map((clip) => {
                const showing = (candidate?.recordingId ?? "") === clip.recordingId;
                return (
                  <button
                    key={clip.recordingId}
                    type="button"
                    onClick={() => setPreviewing(clip)}
                    className={`px-3 py-2 border rounded-lg text-sm transition-colors ${
                      showing
                        ? "border-white bg-gray-800 text-white"
                        : "border-gray-600 text-gray-300 hover:border-gray-300"
                    }`}
                  >
                    {describeClip(clip)}
                    {clip.recordingId === prep.recommended.recordingId && (
                      <span className="ml-2 text-gray-500 text-xs">newest</span>
                    )}
                  </button>
                );
              })}
            </div>
            <Frame
              path={clipPath}
              caption={candidate ? describeClip(candidate) : ""}
            />
            <button
              type="button"
              disabled={!candidate}
              onClick={() => candidate && onUseClip(candidate)}
              className="px-5 py-2.5 text-black bg-white rounded-lg font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              Use this one
            </button>
          </>
        )}

        {prep.status === "copying" && (
          <>
            <Frame
              path={clipPath}
              caption={`Copying — ${prep.clip ? describeClip(prep.clip) : "the recording"}`}
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
              path={clipPath ?? prep.localPath}
              caption={
                prep.clip
                  ? `Ready — ${describeClip(prep.clip)}`
                  : "Ready — chosen by hand"
              }
            />
            <p className="text-green-400 text-sm">
              Verified and on this computer. The rating task will open it without
              asking.
            </p>
          </>
        )}

        {prep.status === "failed" && (
          <div className="border border-yellow-600 rounded-lg p-4">
            <p className="text-yellow-400 text-sm font-semibold">
              No video found automatically.
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
