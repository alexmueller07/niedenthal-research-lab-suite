import { useEffect, useRef, useState } from "react";
import type { TransitionsWriter } from "../utils/transitions";
import VideoTaskMain from "../video-task/VideoTaskMain";
import PartnerHistory from "./PartnerHistory";
import Demographics from "./Demographics";
import PartnerSliders from "./PartnerSliders";
import Experience from "./Experience";
import StudyFeedback from "./StudyFeedback";
import type { ClassificationStepData } from "./types";

// Everything after the conversation-rating task: the short-video task and the
// questionnaires.
//
// WHAT WAS REMOVED, 2026-09-19. Randy: "need to take off all the individual
// measures like loneliness." Ben, separately: "the section on 'how often you
// feel the following previously seen emotions' should be removed, as we are not
// using that questionnaire." Five pages went, and it is worth naming them so
// nobody spends an afternoon wondering where they went:
//
//   - Loneliness (UCLA, 20 items)
//   - Social Connectedness (20 items)
//   - Expressivity (16 items)
//   - Autism-spectrum quotient (10 items)
//   - Emotion frequency ("how often do you feel …", 15 sliders)
//
// That is 81 items. They were trait measures — properties of a person, asked
// once and unchanged by anything the study does — and a session is now several
// rounds long, so asking them would have meant asking the same 81 questions
// after every conversation, or building an exception for them. Randy's answer
// was to stop asking. The randomised block that used to shuffle three of them
// went with them; the randomisation that remains (video set, clip order,
// per-clip perspective order, emotion order) is untouched.
//
// What is left splits cleanly, which is why the split is the prop below:
//
//   per round — about this conversation and this partner:
//     the short-video task, Experience, PartnerSliders, PartnerHistory
//   once per participant — about the person, or about the study as a whole:
//     Demographics, StudyFeedback  (App.tsx runs these, plus the video-sharing
//     page, as the wrap-up when the RA says the day is over)

// Human-readable names for the questionnaire steps, shown on the researcher
// dashboard so "where is this participant" is answerable at a glance.
const STEP_LABELS: Record<string, string> = {
  videoTask: "Video affective-response task",
  experience: "Conversation experience",
  partnerSliders: "Partner ratings",
  partnerHistory: "Partner history",
  demographics: "Demographics",
  studyFeedback: "Study feedback",
};

/** The pages that belong to one conversation, in order. */
const PER_ROUND_STEPS = ["videoTask", "experience", "partnerSliders", "partnerHistory"];

/** The pages asked once, at the end of a participant's last round. */
const WRAP_UP_STEPS = ["demographics", "studyFeedback"];

interface ClassificationTaskMainProps {
  /** Yokes the video set across both members of the dyad. */
  dyadId: string;
  /** Session-wide writer for this round's transitions file. */
  writeRow: TransitionsWriter;
  /**
   * "round" runs the per-conversation pages; "wrapUp" runs the once-only ones.
   * Splitting them is what lets a participant do four conversations without
   * being asked their zip code four times.
   */
  mode?: "round" | "wrapUp";
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
  dyadId,
  writeRow: writeCSVRow,
  mode = "round",
  onComplete,
  onCsvError,
  onProgress,
}: ClassificationTaskMainProps) {
  const handleCsvError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("CSV write failed:", msg);
    onCsvError?.(`Write failed: ${msg}`);
  };

  const [formOrder] = useState<string[]>(() =>
    mode === "wrapUp" ? WRAP_UP_STEPS : PER_ROUND_STEPS
  );
  const [currentFormIndex, setCurrentFormIndex] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<string>(formOrder[0]);

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

  // A step list that starts on a questionnaire (the wrap-up) has to report its
  // first page, because advanceForm only reports the ones it moves to.
  useEffect(() => {
    if (formOrder[0] === "videoTask") return;
    onProgress?.(
      "questionnaires",
      0,
      formOrder.length,
      STEP_LABELS[formOrder[0]] ?? formOrder[0]
    );
    // Once, on mount: this is the arrival announcement, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVideoTaskComplete = () => {
    advanceForm();
  };

  const advanceForm = () => {
    if (currentFormIndex < formOrder.length - 1) {
      const nextIndex = currentFormIndex + 1;
      setCurrentFormIndex(nextIndex);
      setCurrentStep(formOrder[nextIndex]);
      onProgress?.(
        "questionnaires",
        nextIndex,
        formOrder.length,
        STEP_LABELS[formOrder[nextIndex]] ?? formOrder[nextIndex]
      );
    } else {
      setCurrentStep("completed");
      onComplete?.();
    }
  };

  const handleStepComplete = async (stepData?: ClassificationStepData) => {
    try {
      switch (currentStep) {
        case "partnerHistory":
          await writeRowOnce("partnerHistory:met", "partner_history", "Have you met your partner prior to today's study?", "", "", "", stepData?.partnerHistory ? "Yes" : "No");
          await writeRowOnce("partnerHistory:months", "partner_history", "How long have you known your partner? (in months)", "", "", "", String(stepData?.partnerHistoryMonths ?? ""));
          await writeRowOnce("partnerHistory:happy", "partner_history", "I am happy with my friendship with my partner", "", "", "", String((stepData?.matrixSelections as Record<number, number>)?.[0] ?? ""));
          await writeRowOnce("partnerHistory:fun", "partner_history", "My partner is fun to sit and talk with", "", "", "", String((stepData?.matrixSelections as Record<number, number>)?.[1] ?? ""));
          advanceForm();
          break;

        case "demographics":
          await writeRowOnce("demographics:age", "demographics", "Enter your age:", "", "", "", String(stepData?.age ?? ""));
          await writeRowOnce("demographics:hispanicLatino", "demographics", "Are you Spanish, Hispanic, or Latino?", "", "", "", String(stepData?.hispanicLatino ?? ""));
          await writeRowOnce("demographics:races", "demographics", "Choose one or more races that you consider yourself to be:", "", "", "", (stepData?.races as string[] | undefined)?.join(";") ?? "");
          await writeRowOnce("demographics:otherRace", "demographics", "Please specify (other race):", "", "", "", String(stepData?.otherRace ?? ""));
          await writeRowOnce("demographics:sex", "demographics", "What is your sex?", "", "", "", String(stepData?.sex ?? ""));
          await writeRowOnce("demographics:zipCode", "demographics", "Please provide the zip code of your permanent address (where you grew up):", "", "", "", String(stepData?.zipCode ?? ""));
          advanceForm();
          break;

        case "partnerSliders": {
          const order = stepData?.order as string[] | undefined;
          const sliderSel = stepData?.sliderSelections as Record<number, number> | undefined;
          if (order && sliderSel) {
            for (const [index, question] of order.entries()) {
              await writeRowOnce(`partnerSliders:${index}`, "partner_sliders", question, "", "", "", sliderSel[index] ?? "");
            }
          }
          advanceForm();
          break;
        }

        case "experience":
          await writeRowOnce("experience:recorded", "experience", "How often were you thinking about the fact that your conversation was being video recorded?", "", "", "", String(stepData?.sync ?? ""));
          await writeRowOnce("experience:comfortable", "experience", "How comfortable did you feel during the conversation?", "", "", "", String(stepData?.wavelength ?? ""));
          await writeRowOnce("experience:text", "experience", "We're interested in hearing more about your experience during your conversation. Please share any thoughts that you have below", "", "", "", String(stepData?.text ?? ""));
          advanceForm();
          break;

        case "studyFeedback":
          await writeRowOnce("studyFeedback:text", "study_feedback", "We're interested in hearing more about your experience with our study. Please share any thoughts you have below.", "", "", "", String(stepData?.text ?? ""));
          advanceForm();
          break;

        default:
          break;
      }
    } catch (err) {
      handleCsvError(err);
    }
  };

  if (currentStep === "completed") {
    return null;
  }

  // The video task owns the full width: its own pinned header spans edge to
  // edge and its pages already pad themselves. Nesting it in the questionnaire
  // wrapper below double-padded it, which cut the header border short and, once
  // the vertical scrollbar appeared, pushed the page into scrolling sideways.
  if (currentStep === "videoTask") {
    return (
      <VideoTaskMain
        dyadId={dyadId}
        writeRow={writeCSVRow}
        // The sharing page is the last thing a participant does all day, not
        // the last thing they do each round — App.tsx runs it in the wrap-up.
        includeSelection={false}
        onProgress={(done, total, label) => onProgress?.("video", done, total, label)}
        onComplete={handleVideoTaskComplete}
        onCsvError={handleCsvError}
      />
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center bg-black">
      <div className="w-full mx-auto px-8">
        {currentStep === "partnerHistory" && (
          <PartnerHistory onContinue={(data) => handleStepComplete(data)} />
        )}
        {currentStep === "experience" && (
          <Experience onContinue={(data) => handleStepComplete(data)} />
        )}
        {currentStep === "partnerSliders" && (
          <PartnerSliders onContinue={(data) => handleStepComplete(data)} />
        )}
        {currentStep === "demographics" && (
          <Demographics onContinue={(data) => handleStepComplete(data)} />
        )}
        {currentStep === "studyFeedback" && (
          <StudyFeedback onContinue={(data) => handleStepComplete(data)} />
        )}
      </div>
    </div>
  );
}

export default ClassificationTaskMain;
