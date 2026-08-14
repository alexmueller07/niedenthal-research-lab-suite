// Flush registry — lets the admin "save and quit" path drain in-memory data
// before the app exits.
//
// Why this exists: the dyad task buffers continuous slider samples in memory and
// only writes them to disk every 15 seconds (see DyadTaskMain `sliderFlushRef`).
// If a researcher force-quits mid-block, up to ~15 s of samples would be lost.
// The active task registers a flush callback here; the admin quit handler calls
// flushAll() and awaits it before invoking the Tauri `exit_app` command.

type FlushFn = () => Promise<void> | void;

const flushers = new Set<FlushFn>();

// Registers a flush callback and returns an unregister function.
// Call the returned function in a useEffect cleanup so unmounted tasks do not
// leave stale flushers behind.
export function registerFlush(fn: FlushFn): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

// Runs every registered flush callback and waits for all of them to settle.
// Uses allSettled so one failing flush does not prevent the others from running.
export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => Promise.resolve(fn())));
}
