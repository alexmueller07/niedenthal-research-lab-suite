import PressKeyPrompt from "../components/PressKeyPrompt";

interface InstructionsProps {
  instructionIndex: number;
  instructions: string[];
  instructionImages?: { [key: number]: string };
  groupSize?: number;
  onBack?: () => void;
}

function Instructions({
  instructionIndex,
  instructions,
  instructionImages,
  groupSize = 3,
  onBack,
}: InstructionsProps) {
  const getVisibleInstructions = () => {
    const currentGroup = Math.floor(instructionIndex / groupSize);
    const startIndex = currentGroup * groupSize;
    const endIndex = Math.min(startIndex + groupSize, instructionIndex + 1);

    return instructions.slice(startIndex, endIndex).map((text, idx) => ({
      text,
      originalIndex: startIndex + idx,
      hasImage: instructionImages && instructionImages[startIndex + idx] !== undefined,
    }));
  };

  const formatText = (text: string) =>
    text.split("\n").map((line, index) => (
      <span key={index}>
        {line.split("\t").map((part, partIndex) => (
          <span key={partIndex}>
            {partIndex > 0 && <span className="ml-8" />}
            {part}
          </span>
        ))}
        {index < text.split("\n").length - 1 && <br />}
      </span>
    ));

  const visible = getVisibleInstructions();

  return (
    <div className="h-full w-full bg-black cursor-auto relative">
      {instructionIndex > 0 && onBack && (
        <button
          onClick={onBack}
          className="absolute top-10 left-10 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white border border-gray-500 rounded cursor-pointer transition-colors z-10"
        >
          ← Previous
        </button>
      )}

      <div className="relative pt-32 w-full max-w-2xl mx-auto px-8">
        <div className="space-y-6">
          {visible.map((item, idx) => (
            <div key={item.originalIndex} className="min-h-[120px] flex flex-col justify-center">
              <p
                className="text-2xl leading-relaxed"
                style={{ color: idx <= instructionIndex ? "white" : "black" }}
              >
                {formatText(item.text)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-8">
        <PressKeyPrompt />
      </div>
    </div>
  );
}

export default Instructions;
