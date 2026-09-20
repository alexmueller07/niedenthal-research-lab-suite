// The six rows the video-sharing page writes.
//
// Extracted 2026-09-19 when the page gained a second caller: it runs inside the
// video task for a single-round session, and on its own at the end of a
// multi-round one (VideoSelectionStep). The rows are the analysis contract —
// two callers writing them from two copies of the same six lines is how a
// column quietly stops being written on one path.

import type { VideoSelectionResult } from "./VideoSelectionPage";
import type { VideoTaskWriteRow } from "./VideoTaskMain";

export async function writeSelectionRows(
  writeRow: VideoTaskWriteRow,
  result: VideoSelectionResult
): Promise<void> {
  await writeRow("video_selection", "for_partner", "", "", "", result.forPartner.join(";"));
  await writeRow("video_selection", "for_self", "", "", "", result.forSelf.join(";"));
  await writeRow(
    "video_selection",
    "presented_order",
    "",
    "",
    "",
    result.presentedOrder.join(";")
  );
  await writeRow("video_selection", "column_order", "", "", "", result.columnOrder.join(";"));
  await writeRow("video_selection", "n_for_partner", "", "", "", result.forPartner.length);
  await writeRow("video_selection", "n_for_self", "", "", "", result.forSelf.length);
}
