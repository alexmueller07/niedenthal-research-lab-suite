import { useEffect, useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const ORIGINAL_ROWS = [
  "My body reacts very strongly to emotional situations.",
  "I am an emotionally expressive person.",
  "When I'm happy, my feelings show.",
  "I experience my emotions very strongly.",
  "I sometimes cry during sad movies.",
  "I have strong emotions.",
  "I am sometimes unable to hide my feelings, even though I would like to.",
  "No matter how nervous or upset I am, I tend to keep a calm exterior.",
  "I've learned it is better to suppress my anger than to show it.",
  "It is difficult for me to hide my fear.",
  "I laugh out loud when someone tells me a joke that I think is funny.",
  "People often do not know what I am feeling.",
  "What I'm feeling is written all over my face.",
  "There have been times when I have not been able to stop crying even though I tried to stop.",
  "Whenever I feel positive emotions, people can easily see exactly what I am feeling.",
  "Whenever I feel negative emotions, people can easily see exactly what I am feeling.",
];

const COLUMNS = [
  "Strongly Disagree", "Disagree", "Somewhat Disagree",
  "Neither Agree nor Disagree", "Somewhat Agree", "Agree", "Strongly Agree",
];

export default function Expressivity({ onContinue }: ClassificationTaskProps) {
  const [matrixSelections, setMatrixSelections] = useState<{ [key: number]: number }>({});
  const [shuffledRows, setShuffledRows] = useState<string[]>([]);

  useEffect(() => {
    setShuffledRows(shuffle(ORIGINAL_ROWS));
  }, []);

  const isFormValid =
    Object.keys(matrixSelections).length === ORIGINAL_ROWS.length &&
    Object.values(matrixSelections).every((s) => s != null);

  return (
    <QuestionnairePage
      title="Indicate how much you agree or disagree with each statement."
      valid={isFormValid}
      onSubmit={() => onContinue?.({ matrixSelections, order: shuffledRows })}
    >
      <div className="mt-6">
        <div className="grid grid-cols-1 gap-4 mb-6 max-w-2xl mx-auto"></div>
        <MatrixQuestion
          rows={shuffledRows}
          columns={COLUMNS}
          selections={matrixSelections}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
        />
      </div>
    </QuestionnairePage>
  );
}
