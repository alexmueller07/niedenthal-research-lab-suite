import { useEffect, useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const ORIGINAL_QUESTIONS = [
  "I often notice small sounds when others do not",
  "I usually concentrate more on the whole picture, rather than the small details",
  "I find it easy to do more than one thing at once",
  "If there is an interruption, I can switch back to what I was doing very quickly",
  "I find it easy to 'read between the lines' when someone is talking to me",
  "I know how to tell if someone listening to me is getting bored",
  "When I'm reading a story I find it difficult to work out the characters' intentions",
  "I like to collect information about categories of things (e.g. types of car, types of bird, types of train, types of plant etc)",
  "I find it easy to work out what someone is thinking or feeling just by looking at their face",
  "I find it difficult to work out people's intentions",
];

export default function Autism({ onContinue }: ClassificationTaskProps) {
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
      title="Indicate how much you agree or disagree with each statement."
      valid={isFormValid}
      onSubmit={() => onContinue?.({ matrixSelections, order: shuffledQuestions })}
    >
      <div className="mt-6">
        <div className="grid grid-cols-1 gap-4 mb-6 max-w-2xl mx-auto"></div>
        <MatrixQuestion
          rows={shuffledQuestions}
          columns={["Definitely Agree", "Slightly Agree", "Slightly Disagree", "Definitely Disagree"]}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
          selections={matrixSelections}
        />
      </div>
    </QuestionnairePage>
  );
}
