import { useState } from "react";

// Styling matches Suhaas's original app exactly (reference:
// pps-psychology-tauri-app/src/components/MatrixSlider.tsx): text-lg row
// labels on the left, the selected value shown in mono on the right only after
// the row has been touched, space-y-6 rows with border-gray-600 dividers.
//
// Committing an answer: onChange alone could not record the default value —
// releasing the handle exactly where it already sits (e.g. an intended 50 on a
// 50-default scale) fires no change event, so that answer was unrecordable.
// pointerup on the input now commits the current value even when it did not
// move. The untouched handle is dimmed so a default-position handle that was
// never committed is not mistaken for a response.
interface MatrixSliderProps {
  rows: string[];
  onSelectionChange: (rowIndex: number, value: number) => void;
  selections?: { [key: string]: number };
  title?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultSelection?: number;
  leftLabel?: string;
  rightLabel?: string;
}

function MatrixSlider({
  rows,
  onSelectionChange,
  selections = {},
  title,
  className = "",
  min = 1,
  max = 100,
  step = 1,
  defaultSelection = 1,
  leftLabel = "",
  rightLabel = "",
}: MatrixSliderProps) {
  const [interactedRows, setInteractedRows] = useState<Set<number>>(new Set());

  const handleSliderChange = (rowIndex: number, value: number) => {
    setInteractedRows((prev) => new Set(prev).add(rowIndex));
    onSelectionChange(rowIndex, value);
  };

  return (
    <div className={`bg-black border p-6 ${className}`}>
      {title && (
        <h2 className="text-white text-2xl font-bold mb-6 text-center">
          {title}
        </h2>
      )}

      <div className="w-full flex justify-between">
        <p className="text-white text-lg">{leftLabel}</p>
        <p className="text-white text-lg">{rightLabel}</p>
      </div>

      <div className="space-y-6">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="border-b border-gray-600 pb-4 text-center justify-center items-center"
          >
            <div className="flex items-center justify-between mb-3 text-center">
              <label className="text-white text-lg flex-1 pr-4">{row}</label>
              <div className="text-white text-sm font-mono min-w-[3rem] text-right">
                {interactedRows.has(rowIndex)
                  ? selections[row] ?? defaultSelection
                  : ""}
              </div>
            </div>
            <div className="flex items-center justify-center space-x-4">
              <span className="text-white text-sm min-w-[2rem]">{min}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={selections[row] ?? defaultSelection}
                onChange={(e) =>
                  handleSliderChange(rowIndex, parseInt(e.target.value))
                }
                // Releasing the handle commits the value even when it never
                // moved — see the note at the top of this file. Pointer-only
                // on purpose: a keyup commit would fire when a participant
                // merely tabs onto the row, recording an answer they never
                // gave (arrow-key changes already fire onChange).
                onPointerUp={(e) =>
                  handleSliderChange(rowIndex, parseInt(e.currentTarget.value))
                }
                className={`flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider ${
                  interactedRows.has(rowIndex) ? "" : "slider-untouched"
                }`}
                style={{
                  background: interactedRows.has(rowIndex)
                    ? `linear-gradient(to right, #ffffff 0%, #ffffff ${
                        (((selections[row] ?? defaultSelection) - min) /
                          (max - min)) *
                        100
                      }%, #374151 ${
                        (((selections[row] ?? defaultSelection) - min) /
                          (max - min)) *
                        100
                      }%, #374151 100%)`
                    : `linear-gradient(to right, #374151 0%, #374151 50%, #374151 50%, #374151 100%)`,
                }}
              />
              <span className="text-white text-sm min-w-[3rem]">{max}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MatrixSlider;
