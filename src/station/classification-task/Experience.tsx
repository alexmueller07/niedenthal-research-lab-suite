import { useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";

export default function Experience({ onContinue }: ClassificationTaskProps) {
  const [matrixSelections1, setMatrixSelections1] = useState<{ [rowIndex: number]: number }>({});
  const [matrixSelections2, setMatrixSelections2] = useState<{ [rowIndex: number]: number }>({});
  const [textInput, setTextInput] = useState("");
  const [attempted, setAttempted] = useState(false);

  const RECORDED_Q =
    "How often were you thinking about the fact that your conversation was being video recorded?";
  const COMFORT_Q = "How comfortable did you feel during the conversation?";
  const TEXT_Q =
    "We're interested in hearing more about your experience during your conversation.";

  const missing = [
    ...(matrixSelections1[0] === undefined ? [RECORDED_Q] : []),
    ...(matrixSelections2[0] === undefined ? [COMFORT_Q] : []),
    ...(textInput.trim() === "" ? [TEXT_Q] : []),
  ];

  const isFormValid =
    Object.keys(matrixSelections1).length === 1 &&
    Object.keys(matrixSelections2).length === 1 &&
    textInput.trim() !== "";

  return (
    <QuestionnairePage
      valid={isFormValid}
      missing={missing}
      onIncomplete={() => setAttempted(true)}
      onSubmit={() =>
        onContinue?.({
          sync: matrixSelections1[0],
          wavelength: matrixSelections2[0],
          text: textInput,
        })
      }
    >
      <div>
        <MatrixQuestion
          rows={[RECORDED_Q]}
          columns={["Not at all", "", "", "", "", "", "The entire time"]}
          selections={matrixSelections1}
          unansweredRows={attempted && matrixSelections1[0] === undefined ? [0] : []}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections1((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
        />
      </div>
      <div>
        <MatrixQuestion
          rows={[COMFORT_Q]}
          columns={["Extremely uncomfortable", "", "", "", "", "", "Extremely comfortable"]}
          selections={matrixSelections2}
          unansweredRows={attempted && matrixSelections2[0] === undefined ? [0] : []}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections2((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
        />
      </div>
      <div className="mt-8">
        <label className="block text-white text-2xl mb-6">
          {attempted && textInput.trim() === "" && (
            <span className="text-red-400 font-bold mr-1">*</span>
          )}
          We're interested in hearing more about your experience during your
          conversation. Please share any thoughts that you have below.
        </label>
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          className="w-full h-56 p-4 text-white bg-gray-800 border border-white rounded-lg resize-none focus:outline-none focus:border-blue-400 text-xl"
          autoFocus
        />
      </div>
    </QuestionnairePage>
  );
}
