import { useCallback, useEffect, useRef, useState } from "react";

// Plays one stimulus clip.
//
// No native controls: the participant cannot scrub, so "watched the clip" means
// they actually sat through it. Playback starts on an explicit button press
// rather than autoplay — webview autoplay policies block sound-on autoplay, and
// a clip that silently fails to start would look to the participant like a
// broken app.
//
// Watch counts and the time-to-first-completion are reported upward because they
// are data, not UI state: a rating made after half a viewing is not the same
// measurement as one made after a full viewing.

export interface WatchStats {
  /** Number of completed viewings of this clip on this page. */
  plays: number;
  /** Milliseconds from the page appearing to the end of the first viewing. */
  firstWatchMs: number | null;
}

interface StimulusPlayerProps {
  src: string;
  /** Fires each time a viewing runs to the end. */
  onWatched: (stats: WatchStats) => void;
  /** Compact layout for the replay overlay on the rating page. */
  compact?: boolean;
}

export default function StimulusPlayer({ src, onWatched, compact = false }: StimulusPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const statsRef = useRef<WatchStats>({ plays: 0, firstWatchMs: null });

  const [playing, setPlaying] = useState(false);
  const [everPlayed, setEverPlayed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // A new clip resets everything, including the watch clock.
  useEffect(() => {
    mountedAtRef.current = Date.now();
    statsRef.current = { plays: 0, firstWatchMs: null };
    setPlaying(false);
    setEverPlayed(false);
    setEnded(false);
    setLoadError(false);
  }, [src]);

  const start = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    // Explicit, every time. Prior reported silent clips at the 2026-07-29
    // review: a webview that has ever blocked sound-on playback can leave the
    // element muted, and playback then "works" with no audio and no error.
    // Playback only ever starts from this button press, so the gesture that
    // permits sound is always present.
    el.muted = false;
    el.volume = 1;
    setEnded(false);
    void el.play().then(
      () => {
        setPlaying(true);
        setEverPlayed(true);
      },
      (err) => {
        console.error("Stimulus playback failed:", err);
        setLoadError(true);
      }
    );
  }, []);

  const handleEnded = () => {
    setPlaying(false);
    setEnded(true);
    const stats = statsRef.current;
    stats.plays += 1;
    if (stats.firstWatchMs === null) {
      stats.firstWatchMs = Date.now() - mountedAtRef.current;
    }
    onWatched({ ...stats });
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="relative w-full flex items-center justify-center">
        {/* Sized to fill the page rather than a strip in the middle of it
            (Ben, 2026-07-29: the clip took the middle third while the rating
            page took nearly the whole width). */}
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          onEnded={handleEnded}
          onError={() => setLoadError(true)}
          className={`bg-black border border-gray-600 object-contain ${
            compact ? "max-h-[55vh] w-full" : "max-h-[72vh] w-full"
          }`}
        />

        {/* Pre-roll / replay cover. Sits over the video so a stopped clip never
            looks like a frozen app. */}
        {!playing && !loadError && (
          <button
            type="button"
            onClick={start}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 hover:bg-black/60 transition-colors cursor-pointer"
          >
            <span className="text-white text-2xl font-semibold border border-white px-8 py-3">
              {everPlayed ? "Watch again" : "Play video"}
            </span>
            {!everPlayed && (
              <span className="text-gray-300 text-base mt-4">
                The clip plays once through. You cannot fast-forward.
              </span>
            )}
          </button>
        )}

        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 px-8 text-center">
            <p className="text-red-400 text-xl mb-2">This clip could not be loaded.</p>
            <p className="text-gray-300 text-base">
              Please let the researcher know. (Missing file, or the stimulus folder
              is not set on this machine.)
            </p>
          </div>
        )}
      </div>

      {ended && !compact && (
        <p className="text-gray-400 text-base mt-3">
          Viewing complete. You may watch it again, or continue.
        </p>
      )}
    </div>
  );
}
