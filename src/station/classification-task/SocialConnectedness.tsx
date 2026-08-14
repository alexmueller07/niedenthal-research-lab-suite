import { useEffect, useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const ORIGINAL_ROWS = [
  "I feel disconnected from the world around me.",
  "My friends feel like family.",
  "I don't feel I participate with anyone or any group.",
  "I feel distant from people.",
  "Even around people I know, I don't feel that I really belong.",
  "I find myself actively involved in people's lives.",
  "I see people as friendly and approachable.",
  "I am in tune with the world.",
  "I am able to connect with other people.",
  "I feel like an outsider.",
  "I fit well in new situations.",
  "I catch myself losing a sense of connectedness with society.",
  "I don't feel related to most people.",
  "I feel comfortable in the presence of strangers.",
  "I see myself as a loner.",
  "I have little sense of togetherness with my peers.",
  "I feel close to people.",
  "I am able to relate to my peers.",
  "Even among my friends, there is no sense of brother/sisterhood.",
  "I feel understood by the people I know.",
];

const COLUMNS = [
  "Strongly Disagree", "Disagree", "Somewhat Disagree",
  "Neither Agree nor Disagree", "Somewhat Agree", "Agree", "Strongly Agree",
];

export default function SocialConnectedness({ onContinue }: ClassificationTaskProps) {
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
