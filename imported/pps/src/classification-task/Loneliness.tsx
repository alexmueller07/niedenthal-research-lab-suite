import { useEffect, useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const ORIGINAL_QUESTIONS = [
  'How often do you feel that you are "in tune" with the people around you?',
  "How often do you feel that you lack companionship?",
  "How often do you feel that there is no one you can turn to?",
  "How often do you feel alone?",
  "How often do you feel part of a group of friends?",
  "How often do you feel that you have a lot in common with the people around you?",
  "How often do you feel that you are no longer close to anyone?",
  "How often do you feel that your interests and ideas are not shared by those around you?",
  "How often do you feel outgoing and friendly?",
  "How often do you feel close to people?",
  "How often do you feel left out?",
  "How often do you feel that your relationships with others are not meaningful?",
  "How often do you feel that no one really knows you well?",
  "How often do you feel isolated from others?",
  "How often do you feel you can find companionship when you want it?",
  "How often do you feel that there are people who really understand you?",
  "How often do you feel shy?",
  "How often do you feel that people are around you but not with you?",
  "How often do you feel that there are people you can talk to?",
  "How often do you feel that there are people you can turn to?",
];

export default function Loneliness({ onContinue }: ClassificationTaskProps) {
  const [matrixSelections, setMatrixSelections] = useState<{ [key: number]: number }>({});
  const [shuffledQuestions, setShuffledQuestions] = useState<string[]>([]);

  useEffect(() => {
    setShuffledQuestions(shuffle(ORIGINAL_QUESTIONS));
  }, []);

  const isFormValid =
    Object.keys(matrixSelections).length === ORIGINAL_QUESTIONS.length &&
    Object.values(matrixSelections).every((s) => s != null);

  return (
    <QuestionnairePage
      title="Indicate how often each statement applies to you."
      valid={isFormValid}
      onSubmit={() => onContinue?.({ matrixSelections, order: shuffledQuestions })}
    >
      <div className="mt-6">
        <div className="grid grid-cols-1 gap-4 mb-6 max-w-2xl mx-auto"></div>
        <MatrixQuestion
          rows={shuffledQuestions}
          columns={["Never", "Rarely", "Sometimes", "Always"]}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
          selections={matrixSelections}
        />
      </div>
    </QuestionnairePage>
  );
}
