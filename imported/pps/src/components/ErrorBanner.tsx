interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-700 border-b-2 border-red-400 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-white text-2xl font-bold">⚠</span>
        <div>
          <p className="text-white font-bold text-lg">DATA SAVE ERROR — Please alert your RA immediately!</p>
          <p className="text-red-200 text-sm">{message}</p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="ml-8 px-4 py-2 bg-white text-red-700 font-bold rounded hover:bg-red-100 transition-colors text-sm"
      >
        Dismiss
      </button>
    </div>
  );
}
