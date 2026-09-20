import { describe, expect, it } from "vitest";
import { blocksForDuration } from "./DyadTaskMain";

// One-minute blocks, Randy 2026-09-19. The number of blocks is no longer a
// constant — it comes from how long the conversation actually ran — so the
// arithmetic is worth pinning down. This feeds the researcher dashboard only;
// the task itself ends when the video ends, so none of these answers can
// truncate a session.

describe("blocksForDuration", () => {
  it("gives one block per minute", () => {
    expect(blocksForDuration(60)).toBe(1);
    expect(blocksForDuration(120)).toBe(2);
    expect(blocksForDuration(600)).toBe(10);
  });

  it("counts a part-minute at the end as its own block", () => {
    // A 10:30 conversation has an eleventh block worth rating.
    expect(blocksForDuration(630)).toBe(11);
    expect(blocksForDuration(61)).toBe(2);
  });

  it("never reports fewer than one block", () => {
    expect(blocksForDuration(1)).toBe(1);
    expect(blocksForDuration(0)).toBe(1);
    expect(blocksForDuration(-5)).toBe(1);
  });

  // A <video> that has not loaded metadata reports NaN or Infinity for
  // duration, and a dashboard reading "block 2 of NaN" is worse than one that
  // says nothing.
  it("survives a duration the video element does not know yet", () => {
    expect(blocksForDuration(Number.NaN)).toBe(1);
    expect(blocksForDuration(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("matches the old 150-second task on a standard conversation", () => {
    // Sanity anchor: a 10-minute conversation used to be 4 blocks of 150 s and
    // stop there. It is now 10 blocks of 60 s and runs to the end.
    expect(blocksForDuration(600)).toBe(10);
  });
});
