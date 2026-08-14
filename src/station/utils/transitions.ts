// One writer for transitions.csv, shared by every task that writes to it.
//
// It used to live inside ClassificationTaskMain. The post-conversation
// questionnaire (which runs before that task, at the very front of the session)
// writes to the same file, and two independent writers would each have started
// their own trialNumber sequence at 1 — the same number appearing twice in one
// file, with nothing to say which came first. The counter belongs to the file,
// so the writer that owns it is created once per session and passed down.

import { invoke } from "@tauri-apps/api/core";
import type { FormData } from "../App";
import { csvEscape } from "./csv";

const SOFTWARE_VERSION = "2.0.0";

/**
 * Appends one long-format row to transitions.csv.
 *
 * Long format (one row per item, not one row per page) is what the pilot
 * analysis scripts read, so every task writes this shape.
 */
export type TransitionsWriter = (
  ratingTask: string,
  subTask: string,
  emotion1?: string,
  emotion2?: string,
  ratingPerson?: string,
  response?: number | string
) => Promise<void>;

export function createTransitionsWriter(
  formData: FormData,
  csvFilePath: string
): TransitionsWriter {
  let trialNumber = 1;

  return async (
    ratingTask,
    subTask,
    emotion1 = "",
    emotion2 = "",
    ratingPerson = "",
    response = ""
  ) => {
    const row = [
      formData.dyadId,
      formData.participantId,
      formData.partnerId,
      formData.computer,
      formData.subjectInitials,
      formData.raName,
      formData.sessionTime,
      formData.sessionDate,
      new Date().toISOString(),
      ratingTask,
      subTask,
      emotion1,
      emotion2,
      ratingPerson,
      response,
      trialNumber,
      SOFTWARE_VERSION,
    ]
      .map(csvEscape)
      .join(",");

    await invoke("write_csv_transitions", { path: csvFilePath, contents: [row] });
    trialNumber += 1;
  };
}
