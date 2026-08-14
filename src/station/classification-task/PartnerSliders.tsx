import { useEffect, useState } from "react";
import MatrixSlider from "../components/MatrixSlider";
import QuestionnairePage from "../components/QuestionnairePage";
import type { ClassificationTaskProps } from "./types";
import { shuffle } from "../utils/shuffle";

const ORIGINAL_ROWS = ["Is similar to me?", "Is close to me?", "Is familiar to me?"];

export default function PartnerSliders({ onContinue }: ClassificationTaskProps) {
  const [sliderSelections, setSliderSelections] = useState<{ [key: number]: number }>({});
  const [shuffledRows, setShuffledRows] = useState<string[]>([]);

  useEffect(() => {
    setShuffledRows(shuffle(ORIGINAL_ROWS));
  }, []);

  const selectionsForDisplay = Object.entries(sliderSelections).reduce(
    (acc, [rowIndex, value]) => {
      const q = shuffledRows[parseInt(rowIndex)];
      if (q) acc[q] = value;
      return acc;
    },
    {} as { [key: string]: number }
  );

  return (
    <QuestionnairePage
      title="My partner... (1-100: 1 = Not at all, 100 = Very much)"
      valid={Object.keys(sliderSelections).length === ORIGINAL_ROWS.length}
      onSubmit={() => onContinue?.({ sliderSelections, order: shuffledRows })}
      frameClassName="bg-black border p-8 w-10/12 mx-auto flex-1 flex flex-col justify-center"
    >
      <div className="mt-32">
        <MatrixSlider
          rows={shuffledRows}
          leftLabel="Not at all"
          rightLabel="Very much"
          onSelectionChange={(rowIndex, value) =>
            setSliderSelections((prev) => ({ ...prev, [rowIndex]: value }))
          }
          selections={selectionsForDisplay}
        />
      </div>
    </QuestionnairePage>
  );
}
