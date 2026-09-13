import { useEffect, useState } from "react";

import { detectDriveRoots, hasTauri } from "./api";

// One-click Research Drive folders.
//
// Setting the drive used to mean either typing `R:\niedenthal\recordings` from
// memory or walking a folder tree to it, on every machine, every time the share
// was re-mapped. Two shortcuts replace that:
//
//   - Recent — folders this machine has been pointed at before. Kept in the
//     machine profile (machine.rs), newest first.
//   - Detected — folders that exist on this computer right now, probed from the
//     handful of places the lab actually mounts the share.
//
// Neither is authoritative and both can be empty; Browse and the text field are
// always still there. A chip is a shortcut, never the only way in.

interface DriveRootChipsProps {
  /** Previously used folders, newest first, from the machine profile. */
  recent: string[];
  /** Applies a folder. The caller decides whether that also saves it. */
  onPick: (path: string) => void;
  /** Suppresses a chip for the folder already in the field. */
  current?: string;
  /** Station-black by default; the launcher passes its own token classes. */
  className?: string;
}

export default function DriveRootChips({
  recent,
  onPick,
  current,
  className = "",
}: DriveRootChipsProps) {
  const [detected, setDetected] = useState<string[]>([]);

  useEffect(() => {
    if (!hasTauri()) return;
    let live = true;
    // Fire-and-forget: probing a mapped letter whose server has gone away can
    // take seconds, and nothing here is worth making an RA wait for.
    void detectDriveRoots()
      .then((found) => {
        if (live) setDetected(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const normalize = (p: string) => p.trim().toLowerCase().replace(/[/\\]+$/, "");
  const currentKey = current ? normalize(current) : null;

  const seen = new Set<string>();
  const chips: { path: string; source: "recent" | "detected" }[] = [];
  for (const [list, source] of [
    [recent, "recent"],
    [detected, "detected"],
  ] as const) {
    for (const path of list) {
      const key = normalize(path);
      if (!key || key === currentKey || seen.has(key)) continue;
      seen.add(key);
      chips.push({ path, source });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {chips.map(({ path, source }) => (
        <button
          key={path}
          type="button"
          onClick={() => onPick(path)}
          title={`Use ${path}`}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-600 rounded-lg text-xs hover:border-white transition-colors"
        >
          <span className="text-gray-500 uppercase tracking-wide">
            {source === "recent" ? "Recent" : "Found"}
          </span>
          <span className="font-mono break-all">{path}</span>
        </button>
      ))}
    </div>
  );
}
