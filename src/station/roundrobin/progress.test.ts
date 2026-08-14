import { describe, expect, it } from "vitest";
import {
  STUDY_STAGES,
  isHelpOpen,
  mergeProgress,
  overallFraction,
  progressFileName,
  stageIndex,
  stageLabel,
} from "./progress";
import type { RRProgress } from "./progress";

function entry(patch: Partial<RRProgress> = {}): RRProgress {
  return {
    email: "p1@wisc.edu",
    stage: "video",
    done: 0,
    total: 25,
    updatedAt: "2026-07-23T12:00:00.000Z",
    ...patch,
  };
}

describe("progress file names", () => {
  it("matches the name the Rust side accepts", () => {
    expect(progressFileName("p1@wisc.edu")).toMatch(/^p-[0-9a-f]{8}\.json$/);
  });

  it("is stable across case and whitespace, so one person keeps one file", () => {
    expect(progressFileName("  P1@WISC.EDU ")).toBe(progressFileName("p1@wisc.edu"));
  });

  it("gives different participants different files", () => {
    expect(progressFileName("a@wisc.edu")).not.toBe(progressFileName("b@wisc.edu"));
  });
});

describe("stages", () => {
  it("labels every stage", () => {
    for (const stage of STUDY_STAGES) {
      expect(stageLabel(stage.key)).toBe(stage.label);
    }
  });

  it("orders stages as the participant meets them", () => {
    expect(stageIndex("checkin")).toBeLessThan(stageIndex("dyad"));
    expect(stageIndex("dyad")).toBeLessThan(stageIndex("video"));
    expect(stageIndex("video")).toBeLessThan(stageIndex("questionnaires"));
    expect(stageIndex("questionnaires")).toBeLessThan(stageIndex("done"));
  });
});

describe("overall fraction", () => {
  it("starts at zero and ends at one", () => {
    expect(overallFraction(entry({ stage: "checkin", done: 0, total: 1 }))).toBe(0);
    expect(overallFraction(entry({ stage: "done", done: 1, total: 1 }))).toBe(1);
  });

  it("never leaves the 0-1 range, even on a bad step count", () => {
    const overshoot = overallFraction(entry({ stage: "video", done: 99, total: 25 }));
    expect(overshoot).toBeGreaterThanOrEqual(0);
    expect(overshoot).toBeLessThanOrEqual(1);
  });

  it("increases as the participant moves through a stage", () => {
    const early = overallFraction(entry({ done: 2 }));
    const late = overallFraction(entry({ done: 20 }));
    expect(late).toBeGreaterThan(early);
  });

  it("increases across stages", () => {
    const dyad = overallFraction(entry({ stage: "dyad", done: 0, total: 4 }));
    const video = overallFraction(entry({ stage: "video", done: 0, total: 25 }));
    expect(video).toBeGreaterThan(dyad);
  });

  it("handles a stage with no step count", () => {
    expect(overallFraction(entry({ stage: "dyad", done: 0, total: 0 }))).toBeGreaterThan(0);
  });
});

describe("help requests", () => {
  it("is closed when nobody asked", () => {
    expect(isHelpOpen(entry())).toBe(false);
  });

  it("is open once requested", () => {
    expect(isHelpOpen(entry({ helpRequestedAt: "2026-07-23T12:05:00.000Z" }))).toBe(true);
  });

  it("closes when the researcher clears it", () => {
    expect(
      isHelpOpen(
        entry({
          helpRequestedAt: "2026-07-23T12:05:00.000Z",
          helpResolvedAt: "2026-07-23T12:06:00.000Z",
        })
      )
    ).toBe(false);
  });

  it("reopens when the participant asks again after being helped", () => {
    expect(
      isHelpOpen(
        entry({
          helpRequestedAt: "2026-07-23T12:30:00.000Z",
          helpResolvedAt: "2026-07-23T12:06:00.000Z",
        })
      )
    ).toBe(true);
  });
});

describe("mergeProgress", () => {
  it("keeps fields the patch does not mention", () => {
    const merged = mergeProgress(
      entry({ helpRequestedAt: "2026-07-23T12:05:00.000Z" }),
      "p1@wisc.edu",
      { done: 7 }
    );
    expect(merged.done).toBe(7);
    expect(merged.stage).toBe("video");
    expect(merged.helpRequestedAt).toBe("2026-07-23T12:05:00.000Z");
  });

  it("starts a fresh record at check-in when there is nothing yet", () => {
    const merged = mergeProgress(undefined, "new@wisc.edu", {});
    expect(merged.stage).toBe("checkin");
    expect(merged.email).toBe("new@wisc.edu");
  });

  it("always stamps the update time", () => {
    const merged = mergeProgress(entry(), "p1@wisc.edu", { done: 1 });
    expect(merged.updatedAt).not.toBe("2026-07-23T12:00:00.000Z");
  });
});
