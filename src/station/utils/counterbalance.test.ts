import { describe, expect, it } from "vitest";
import { startingTarget } from "./counterbalance";

describe("which perspective a participant starts with", () => {
  it("gives the odd ID self and the even ID partner", () => {
    expect(startingTarget("1", "Left").target).toBe("self");
    expect(startingTarget("2", "Right").target).toBe("partner");
    expect(startingTarget("27", "Left").target).toBe("self");
    expect(startingTarget("28", "Right").target).toBe("partner");
  });

  it("puts the two members of a dyad on opposite perspectives", () => {
    // The property the whole design rests on: for dyad n, ids 2n-1 and 2n
    // never start on the same perspective. If they did, the two traces would
    // cover the same target over the same seconds and there would be nothing
    // to score an empathic-accuracy difference against.
    for (let n = 1; n <= 60; n += 1) {
      const left = startingTarget(String(2 * n - 1), "Left").target;
      const right = startingTarget(String(2 * n), "Right").target;
      expect(left).not.toBe(right);
    }
  });

  it("says what the choice was based on, so the data file can record it", () => {
    expect(startingTarget("27", "Left").basis).toBe("participant_id_parity(27)");
    expect(startingTarget("pilot-a", "Right").basis).toBe("seat(right)");
    expect(startingTarget("", "").basis).toBe("default");
  });

  it("falls back to the seat when the ID is not a number", () => {
    expect(startingTarget("pilot-a", "Left").target).toBe("self");
    expect(startingTarget("pilot-a", "Right").target).toBe("partner");
  });

  it("falls back to self when nothing says otherwise", () => {
    // What every participant did before the rule was implemented. Keeping it
    // as the floor means an unusual session degrades to the old behaviour
    // rather than to something arbitrary.
    expect(startingTarget("", "").target).toBe("self");
    expect(startingTarget("0", "").target).toBe("self");
  });
});
