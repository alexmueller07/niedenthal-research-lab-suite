import { useState } from "react";
import MatrixQuestion from "../components/MatrixQuestion";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";

export default function Experience({ onContinue }: ClassificationTaskProps) {
  const [matrixSelections1, setMatrixSelections1] = useState<{ [rowIndex: number]: number }>({});
  const [matrixSelections2, setMatrixSelections2] = useState<{ [rowIndex: number]: number }>({});
  const [textInput, setTextInput] = useState("");

  const isFormValid =
    Object.keys(matrixSelections1).length === 1 &&
    Object.keys(matrixSelections2).length === 1 &&
    textInput.trim() !== "";

  return (
    <QuestionnairePage
      valid={isFormValid}
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
          rows={["How often were you thinking about the fact that your conversation was being video recorded?"]}
          columns={["Not at all", "", "", "", "", "", "The entire time"]}
          selections={matrixSelections1}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections1((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
        />
      </div>
      <div>
        <MatrixQuestion
          rows={["How comfortable did you feel during the conversation?"]}
          columns={["Extremely uncomfortable", "", "", "", "", "", "Extremely comfortable"]}
          selections={matrixSelections2}
          onSelectionChange={(rowIndex, columnIndex) =>
            setMatrixSelections2((prev) => ({ ...prev, [rowIndex]: columnIndex }))
          }
        />
      </div>
      <div className="mt-8">
        <label className="block text-white text-2xl mb-6">
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
