import { useEffect, useRef, useState } from "react";
import { previewFrame } from "../api";

/**
 * Live camera view, fed by FFmpeg rather than getUserMedia.
 *
 * This is deliberate. On Windows a DirectShow camera is usually exclusive
 * access: if the webview held the device through getUserMedia, FFmpeg could not
 * open it at all and recording would simply fail. Driving the preview from the
 * capture process itself also means the preview *is* the recording — motion on
 * screen is evidence that frames are genuinely arriving, not that some other
 * pipeline is alive.
 */
export function usePreviewFrame(active: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [everReceived, setEverReceived] = useState(false);
  const [stalled, setStalled] = useState(false);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      setUrl(null);
      setEverReceived(false);
      setStalled(false);
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      // Rust reads from disk on every call; overlapping requests would queue up
      // behind each other on a slow drive and never catch back up.
      if (inFlight) return;
      inFlight = true;
      try {
        const bytes = await previewFrame();
        if (cancelled) return;
        if (bytes.byteLength === 0) {
          // Rust returns nothing for a frame older than two seconds, which is
          // how a stopped camera is distinguished from a slow one.
          setStalled(true);
          return;
        }
        setStalled(false);
        setEverReceived(true);
        const next = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        setUrl(next);
        if (previous.current) URL.revokeObjectURL(previous.current);
        previous.current = next;
      } catch {
        if (!cancelled) setStalled(true);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(tick, 100);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (previous.current) {
        URL.revokeObjectURL(previous.current);
        previous.current = null;
      }
    };
  }, [active]);

  return { url, everReceived, stalled };
}

interface Props {
  active: boolean;
  /** Shown over the image while a take is running. */
  overlay?: React.ReactNode;
  /**
   * Reports whether frames are genuinely arriving. The record button is gated
   * on this: a camera that never delivers a first frame would otherwise let
   * an RA start a take that records nothing.
   */
  onSignal?: (delivering: boolean) => void;
}

export default function PreviewPane({ active, overlay, onSignal }: Props) {
  const { url, everReceived, stalled } = usePreviewFrame(active);

  const delivering = active && everReceived && !stalled;
  useEffect(() => {
    onSignal?.(delivering);
    return () => onSignal?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivering]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[--color-panel-edge] bg-black">
      {url ? (
        <img src={url} alt="Camera preview" className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-8 text-center">
          <p className="text-sm text-[--color-ink-dim]">
            {!active
              ? "Preview is off. Choose a camera to see what it sees."
              : everReceived
                ? "Signal lost — the camera stopped sending frames."
                : "Opening the camera…"}
          </p>
        </div>
      )}

      {active && everReceived && stalled && (
        <div className="absolute inset-x-0 top-0 bg-[--color-bad] px-3 py-1.5 text-center text-xs font-semibold text-white">
          No frames for over 2 seconds — check the cable and that nothing else has the camera
        </div>
      )}

      {overlay}
    </div>
  );
}
