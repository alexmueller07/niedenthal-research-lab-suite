import { useState } from "react";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";

export default function StudyFeedback({ onContinue }: ClassificationTaskProps) {
  const [textInput, setTextInput] = useState("");

  return (
    <QuestionnairePage
      valid={textInput.trim() !== ""}
      missing={
        textInput.trim() === ""
          ? ["We're interested in hearing more about your experience with our study."]
          : []
      }
      onSubmit={() => onContinue?.({ text: textInput })}
    >
      <div className="mt-6">
        <label className="block text-white text-2xl mb-6 mt-32">
          We're interested in hearing more about your experience with our study.
          Please share any thoughts you have below.
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
