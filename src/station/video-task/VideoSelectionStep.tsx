// The video-sharing page, on its own.
//
// Randy, 2026-09-19: "the last thing they should do before we bring them back
// to the done stream is the video task of selecting who their partner would
// want for that." With sessions split into rounds, the clip trials run once per
// conversation while this page is asked once, at the very end of a
// participant's day — so it needed to come out of VideoTaskMain's own flow.
//
// It draws the same set the round's trials drew (both derive it from the round
// number — see videos.ts `assignSet`), so a participant is asked about clips
// they have just been rating, and the row order is shuffled here exactly as it
// was shuffled there.

import { useCallback, useEffect, useState } from "react";
import VideoSelectionPage from "./VideoSelectionPage";
import type { VideoSelectionResult } from "./VideoSelectionPage";
import { writeSelectionRows } from "./selectionRows";
import type { VideoTaskWriteRow } from "./VideoTaskMain";
import { assignSet, resolveVideoSrc } from "./videos";
import { EMPTY_SETTINGS, loadSettings } from "../utils/settings";
import type { AppSettings } from "../utils/settings";
import { shuffle } from "../utils/shuffle";

interface VideoSelectionStepProps {
  /** The round whose clips are being asked about — the participant's last. */
  round: number;
  writeRow: VideoTaskWriteRow;
  onComplete: () => void;
  onCsvError?: (err: unknown) => void;
}

export default function VideoSelectionStep({
  round,
  writeRow,
  onComplete,
  onCsvError,
}: VideoSelectionStepProps) {
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [set] = useState(() => assignSet(round));
  const [selectionOrder] = useState<string[]>(() => shuffle(set.videoIds));

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

  const handleSubmit = async (result: VideoSelectionResult) => {
    try {
      await writeSelectionRows(writeRow, result);
    } catch (err) {
      console.error("Video selection write failed:", err);
      onCsvError?.(err);
    }
    onComplete();
  };

  if (!settingsLoaded) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black">
        <h1 className="text-white text-4xl font-bold">Loading...</h1>
      </div>
    );
  }

  return (
    <VideoSelectionPage
      videoIds={selectionOrder}
      srcFor={srcFor}
      onSubmit={(result) => void handleSubmit(result)}
    />
  );
}
