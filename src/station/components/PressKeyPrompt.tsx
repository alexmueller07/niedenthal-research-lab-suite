interface PressKeyPromptProps {
  keyLabel?: string;
  text?: string;
}

export default function PressKeyPrompt({
  keyLabel = "any key",
  text = "to continue",
}: PressKeyPromptProps) {
  return (
    <div className="mt-32 p-4 bg-gray-800 rounded-lg border border-gray-600">
      <p className="text-white text-2xl text-center">
        Press{" "}
        {keyLabel !== "any key" ? (
          <kbd className="px-2 py-1 bg-gray-700 rounded text-sm">{keyLabel}</kbd>
        ) : (
          <span className="text-white text-2xl">any key</span>
        )}{" "}
        {text}
      </p>
    </div>
  );
}
