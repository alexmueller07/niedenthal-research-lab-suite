import { useRef, useState } from "react";
import type { TransitionsWriter } from "../utils/transitions";
import VideoTaskMain from "../video-task/VideoTaskMain";
import PartnerHistory from "./PartnerHistory";
import PartnerSliders from "./PartnerSliders";
import type { ClassificationStepData } from "./types";

// The short-video task and the two questionnaires that follow it.
//
// WHAT IS LEFT, AND WHY IT IS SO LITTLE. Randy, 2026-09-20: "After the TikTok
// task, all the questionnaires should be removed OTHER than questions about
// maybe how similar, familiar, [close] you are to your partner and whether you
// knew this person before the day. All other individual difference /
// questionnaires are done before the study starts."
//
// So the answer to "where did questionnaire X go" is one of two places. Either
// it is asked outside this app, before the participant sits down, or it is not
// asked any more:
//
//   removed 2026-09-19 — loneliness (20 items), social connectedness (20),
//     expressivity (16), autism-spectrum quotient (10), emotion frequency (15
//     sliders). Trait measures, and a multi-round session would have asked them
//     after every single conversation.
//   removed 2026-09-20 — conversation experience (being recorded, comfort, free
//     text), demographics, study feedback.
//
// What remains is the two things that are about THIS partner, and therefore
// have to be asked again for each new one:
//
//   PartnerSliders  — similar to me / close to me / familiar to me
//   PartnerHistory  — had you met before today, and if so how well do you know
//                     them
//
// The post-conversation questions still run, but before the slider task rather
// than here — they are the first thing a participant sees (App.tsx).

/** The pages that belong to one conversation, in order. */
const STEPS = ["videoTask", "partnerSliders", "partnerHistory"] as const;

/** Human-readable names, shown on the researcher dashboard. */
const STEP_LABELS: Record<string, string> = {
  videoTask: "Video affective-response task",
  partnerSliders: "Partner ratings",
  partnerHistory: "Partner history",
};

interface ClassificationTaskMainProps {
  /** Picks this round's clip group — see videos.ts `assignSet`. */
  round: number;
  /** Session-wide writer for this round's transitions file. */
  writeRow: TransitionsWriter;
  onComplete?: () => void;
  onCsvError?: (msg: string) => void;
  /** Reports progress for the researcher dashboard. */
  onProgress?: (
    stage: "video" | "questionnaires",
    done: number,
    total: number,
    detail: string
  ) => void;
}

function ClassificationTaskMain({
  round,
  writeRow: writeCSVRow,
  onComplete,
  onCsvError,
  onProgress,
}: ClassificationTaskMainProps) {
  const handleCsvError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("CSV write failed:", msg);
    onCsvError?.(`Write failed: ${msg}`);
  };

  const [stepIndex, setStepIndex] = useState<number>(0);
  // Past the end of STEPS means the round's pages are done. Kept as an index
  // rather than a "completed" step name so TypeScript can see that every value
  // `currentStep` takes below is a real step.
  const finished = stepIndex >= STEPS.length;
  const currentStep = STEPS[Math.min(stepIndex, STEPS.length - 1)];

  // Ledger of rows already written. A failed write leaves the participant on
  // the same page, and Continue re-runs the whole step below; the transitions
  // file is append-only, so rows that landed on the first attempt must be
  // skipped on the retry, not appended a second time. Keys are namespaced by
  // step, so the ledger never needs clearing; the step only advances once every
  // one of its rows has been written. (A row that landed keeps its
  // first-attempt value even if the answer was edited before the retry.)
  const writtenRowsRef = useRef<Set<string>>(new Set());

  /** Writes one row unless this key already made it to disk on a prior attempt. */
  const writeRowOnce = async (key: string, ...row: Parameters<TransitionsWriter>) => {
    if (writtenRowsRef.current.has(key)) return;
    await writeCSVRow(...row);
    writtenRowsRef.current.add(key);
  };

  const advance = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex >= STEPS.length) {
      setStepIndex(nextIndex);
      onComplete?.();
      return;
    }
    setStepIndex(nextIndex);
    onProgress?.(
      "questionnaires",
      nextIndex,
      STEPS.length,
      STEP_LABELS[STEPS[nextIndex]] ?? STEPS[nextIndex]
    );
  };

  const handleStepComplete = async (stepData?: ClassificationStepData) => {
    try {
      switch (currentStep) {
        case "partnerSliders": {
          const order = stepData?.order as string[] | undefined;
          const sliderSel = stepData?.sliderSelections as Record<number, number> | undefined;
          if (order && sliderSel) {
            for (const [index, question] of order.entries()) {
              await writeRowOnce(`partnerSliders:${index}`, "partner_sliders", question, "", "", "", sliderSel[index] ?? "");
            }
          }
          advance();
          break;
        }

        case "partnerHistory":
          await writeRowOnce("partnerHistory:met", "partner_history", "Have you met your partner prior to today's study?", "", "", "", stepData?.partnerHistory ? "Yes" : "No");
          await writeRowOnce("partnerHistory:months", "partner_history", "How long have you known your partner? (in months)", "", "", "", String(stepData?.partnerHistoryMonths ?? ""));
          await writeRowOnce("partnerHistory:happy", "partner_history", "I am happy with my friendship with my partner", "", "", "", String((stepData?.matrixSelections as Record<number, number>)?.[0] ?? ""));
          await writeRowOnce("partnerHistory:fun", "partner_history", "My partner is fun to sit and talk with", "", "", "", String((stepData?.matrixSelections as Record<number, number>)?.[1] ?? ""));
          advance();
          break;

        default:
          break;
      }
    } catch (err) {
      handleCsvError(err);
    }
  };

  if (finished) {
    return null;
  }

  // The video task owns the full width: its own pinned header spans edge to
  // edge and its pages already pad themselves. Nesting it in the questionnaire
  // wrapper below double-padded it, which cut the header border short and, once
  // the vertical scrollbar appeared, pushed the page into scrolling sideways.
  if (currentStep === "videoTask") {
    return (
      <VideoTaskMain
        round={round}
        writeRow={writeCSVRow}
        onProgress={(done, total, label) => onProgress?.("video", done, total, label)}
        onComplete={advance}
        onCsvError={handleCsvError}
      />
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center bg-black">
      <div className="w-full mx-auto px-8">
        {currentStep === "partnerSliders" && (
          <PartnerSliders onContinue={(data) => handleStepComplete(data)} />
        )}
        {currentStep === "partnerHistory" && (
          <PartnerHistory onContinue={(data) => handleStepComplete(data)} />
        )}
      </div>
    </div>
  );
}

export default ClassificationTaskMain;
