import { describe, expect, it } from "vitest";

import { describeClip, fetchableClips, newestClip } from "./api";
import type { RemoteClip } from "./api";

function clip(overrides: Partial<RemoteClip>): RemoteClip {
  return {
    recordingId: "r",
    slotId: "s",
    sessionDate: "2026-08-13",
    round: 1,
    roomIndex: 1,
    durationMs: null,
    mimeType: "video/mp4",
    partner: null,
    url: "/api/recordings/r/file",
    storageKey: "slot/round-1/room-1-a-b.mp4",
    sha256: null,
    ...overrides,
  };
}

describe("newestClip", () => {
  it("returns null for an empty list", () => {
    expect(newestClip([])).toBeNull();
  });

  it("returns the single clip in the ordinary dyadic case", () => {
    const only = clip({ recordingId: "only" });
    expect(newestClip([only])?.recordingId).toBe("only");
  });

  it("prefers the latest session date over a higher round on an older day", () => {
    const oldHighRound = clip({ recordingId: "old", sessionDate: "2026-08-06", round: 3 });
    const todayRound1 = clip({ recordingId: "new", sessionDate: "2026-08-13", round: 1 });
    expect(newestClip([oldHighRound, todayRound1])?.recordingId).toBe("new");
  });

  it("prefers the highest round within the same session", () => {
    const r1 = clip({ recordingId: "r1", round: 1 });
    const r3 = clip({ recordingId: "r3", round: 3 });
    const r2 = clip({ recordingId: "r2", round: 2 });
    expect(newestClip([r1, r3, r2])?.recordingId).toBe("r3");
  });

  it("does not mutate the input order", () => {
    const clips = [clip({ recordingId: "a", round: 1 }), clip({ recordingId: "b", round: 2 })];
    newestClip(clips);
    expect(clips.map((c) => c.recordingId)).toEqual(["a", "b"]);
  });
});

describe("fetchableClips", () => {
  it("drops clips the server sent without a storage key", () => {
    const withKey = clip({ recordingId: "with" });
    const withoutKey = clip({ recordingId: "without", storageKey: null });
    expect(fetchableClips([withKey, withoutKey]).map((c) => c.recordingId)).toEqual(["with"]);
  });
});

describe("describeClip", () => {
  it("names the round, partner, and date", () => {
    const c = clip({
      round: 2,
      sessionDate: "2026-08-13",
      partner: { id: "p", fullName: "Jordan P.", email: "j@wisc.edu" },
    });
    expect(describeClip(c)).toBe("Round 2 with Jordan P. — 2026-08-13");
  });

  it("stays readable when the partner is unknown", () => {
    const c = clip({ round: 1, partner: null, sessionDate: null });
    expect(describeClip(c)).toBe("Round 1");
  });
});
