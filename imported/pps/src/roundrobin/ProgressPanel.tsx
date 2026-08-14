import type { ProgressMap, RRProgress } from "./progress";
import { isHelpOpen, overallFraction, stageLabel } from "./progress";

// Live view of where each participant currently is in the app, for the
// researcher dashboard. Sessions in progress sort to the top; anyone who
// pressed the help button sorts above everything.

interface ProgressPanelProps {
  progress: ProgressMap;
  onClearHelp: (entry: RRProgress) => void;
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function ProgressBar({ fraction }: { fraction: number }) {
  const percent = Math.round(fraction * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-700 min-w-[8rem]">
        <div className="h-full bg-white" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-white text-sm font-mono min-w-[3rem] text-right">{percent}%</span>
    </div>
  );
}

export default function ProgressPanel({ progress, onClearHelp }: ProgressPanelProps) {
  const entries = Object.values(progress).sort((a, b) => {
    const help = Number(isHelpOpen(b)) - Number(isHelpOpen(a));
    if (help !== 0) return help;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const needHelp = entries.filter(isHelpOpen);

  return (
    <div className="bg-black border p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-white text-xl font-bold">Session progress</h2>
        <span className="text-gray-400 text-sm">
          {entries.length} participant{entries.length === 1 ? "" : "s"} tracked
        </span>
      </div>

      {needHelp.length > 0 && (
        <div className="border border-red-500 bg-red-950/40 p-4 mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-red-300 text-lg font-bold">
              Help requested ({needHelp.length})
            </h3>
            {needHelp.length > 1 && (
              <button
                type="button"
                onClick={() => needHelp.forEach(onClearHelp)}
                className="text-red-300 text-sm underline hover:text-white transition-colors"
              >
                clear all
              </button>
            )}
          </div>
          {needHelp.map((entry) => (
            <div
              key={entry.email}
              className="flex items-center justify-between py-1.5 border-b border-red-900 last:border-b-0"
            >
              <span className="text-white">
                {entry.email}{" "}
                <span className="text-red-300">
                  — {stageLabel(entry.stage)}
                  {entry.detail ? ` · ${entry.detail}` : ""}
                  {entry.helpRequestedAt ? ` · asked ${ago(entry.helpRequestedAt)}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onClearHelp(entry)}
                className="px-4 py-1.5 rounded-lg border border-white bg-white text-black hover:bg-gray-200 transition-colors text-sm"
              >
                clear
              </button>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-gray-400 text-sm">
          Nothing yet. A participant appears here as soon as they check in on a
          machine that shares this tracking folder.
        </p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-white text-left p-2 border-b border-white">Participant</th>
              <th className="text-white text-left p-2 border-b border-white">Stage</th>
              <th className="text-white text-left p-2 border-b border-white">Currently on</th>
              <th className="text-white text-left p-2 border-b border-white w-64">
                Through the session
              </th>
              <th className="text-white text-left p-2 border-b border-white">Updated</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.email} className="border-b border-gray-600">
                <td className="text-white p-2">
                  {isHelpOpen(entry) && <span className="text-red-400 mr-2">●</span>}
                  {entry.email}
                </td>
                <td className="text-white p-2">{stageLabel(entry.stage)}</td>
                <td className="text-white p-2">
                  {entry.detail ?? "—"}
                  {entry.total > 0 && (
                    <span className="text-gray-400 text-sm">
                      {" "}
                      ({entry.done}/{entry.total})
                    </span>
                  )}
                </td>
                <td className="p-2">
                  <ProgressBar fraction={overallFraction(entry)} />
                </td>
                <td className="text-white p-2">{ago(entry.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
