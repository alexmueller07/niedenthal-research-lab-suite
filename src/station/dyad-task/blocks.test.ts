import { describe, expect, it } from "vitest";
import { blocksForDuration } from "./DyadTaskMain";

// 150-second blocks (back from 60 s on 2026-10-19). The number of blocks is not
// a constant — it comes from how long the conversation actually ran — so the
// arithmetic is worth pinning down. This feeds the researcher dashboard only;
// the task itself ends when the video ends, so none of these answers can
// truncate a session.

describe("blocksForDuration", () => {
  it("gives one block per 2.5 minutes", () => {
    expect(blocksForDuration(150)).toBe(1);
    expect(blocksForDuration(300)).toBe(2);
    expect(blocksForDuration(600)).toBe(4);
  });

  it("counts a part-block at the end as its own block", () => {
    // A 10:30 conversation has a fifth block worth rating.
    expect(blocksForDuration(630)).toBe(5);
    expect(blocksForDuration(151)).toBe(2);
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

  it("matches the pilot's 150-second task on a standard conversation", () => {
    // A 10-minute conversation is 4 blocks of 150 s, as in the pilot.
    expect(blocksForDuration(600)).toBe(4);
  });
});
