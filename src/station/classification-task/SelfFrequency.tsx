import { useState } from "react";
import MatrixSlider from "../components/MatrixSlider";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const EMOTIONS = [
  "confident", "grouchy", "sad", "assertive", "unrestrained",
  "nervous", "irritable", "lively", "bold", "talkative",
  "satisfaction", "love", "contempt", "disgust", "embarrassment",
];

export default function SelfFrequency({ onContinue }: ClassificationTaskProps) {
  const [sliderSelections, setSliderSelections] = useState<{ [key: string]: number }>({});
  const [touchedRows, setTouchedRows] = useState<Set<string>>(new Set());

  const [shuffledEmotions] = useState(() => shuffle(EMOTIONS));

  const handleSliderSelectionChange = (rowIndex: number, value: number) => {
    const emotion = shuffledEmotions[rowIndex];
    setSliderSelections((prev) => ({ ...prev, [emotion]: value }));
    setTouchedRows((prev) => { const next = new Set(prev); next.add(emotion); return next; });
  };

  return (
    <QuestionnairePage
      title="In this part of the study, you will be asked to estimate how often YOU experience each of the previously seen states. (0-100: 0 = Never, 100 = All the time)"
      valid={touchedRows.size === EMOTIONS.length}
      onSubmit={() => onContinue?.({ ratings: sliderSelections, order: shuffledEmotions })}
      confirmMessage="There are unanswered questions on this page. Would you like to continue?"
      confirmText="Continue"
      cancelText="Close"
      frameClassName="bg-black border p-8 w-10/12 mx-auto flex-1 flex flex-col justify-center"
    >
      <MatrixSlider
        leftLabel="Never"
        rightLabel="All the time"
        min={0}
        max={100}
        defaultSelection={50}
        rows={shuffledEmotions}
        onSelectionChange={handleSliderSelectionChange}
        selections={sliderSelections}
      />
    </QuestionnairePage>
  );
}
