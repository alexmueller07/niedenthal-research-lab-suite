import { describe, expect, it } from "vitest";
import { retriesExhausted, retryStatusText } from "./RetryCountdown";

describe("automatic video re-search wording", () => {
  const now = 1_000_000;

  it("counts down to the next try in whole seconds", () => {
    expect(retryStatusText({ attempt: 1, nextAt: now + 9_200, max: 4 }, now)).toBe(
      "Looking again automatically in 9 s (try 2 of 4)"
    );
  });

  it("never shows more than the interval for a try scheduled a tick ago", () => {
    expect(retryStatusText({ attempt: 2, nextAt: now + 10_240, max: 4 }, now)).toBe(
      "Looking again automatically in 10 s (try 3 of 4)"
    );
  });

  it("says it is looking once the countdown reaches zero", () => {
    expect(retryStatusText({ attempt: 0, nextAt: now - 5, max: 4 }, now)).toBe(
      "Looking again automatically (try 1 of 4)…"
    );
  });

  it("does not print a try number before the first one is scheduled", () => {
    expect(retryStatusText({ attempt: 0, nextAt: null, max: 4 }, now)).toBe(
      "Looking again automatically…"
    );
  });

  it("hands over to the RA's button after the last try", () => {
    const spent = { attempt: 4, nextAt: null, max: 4 };
    expect(retriesExhausted(spent)).toBe(true);
    expect(retryStatusText(spent, now)).toBeNull();
  });

  it("is not exhausted while the last try is still scheduled", () => {
    expect(retriesExhausted({ attempt: 3, nextAt: now + 1, max: 4 })).toBe(false);
  });
});
