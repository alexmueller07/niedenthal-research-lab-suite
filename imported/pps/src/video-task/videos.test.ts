import { describe, expect, it } from "vitest";
import {
  EMOTIONS_PER_VIDEO,
  VIDEOS_PER_SET,
  VIDEO_CATALOG,
  VIDEO_SETS,
  assignSet,
  findVideo,
  joinPath,
  resolveVideoSrc,
  videosInSet,
} from "./videos";

describe("stimulus catalog", () => {
  it("has no duplicate clip ids", () => {
    const ids = VIDEO_CATALOG.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("probes exactly three emotions per clip", () => {
    for (const video of VIDEO_CATALOG) {
      expect(video.emotions).toHaveLength(EMOTIONS_PER_VIDEO);
      expect(new Set(video.emotions).size).toBe(EMOTIONS_PER_VIDEO);
    }
  });

  it("keeps the full annotation when more than three emotions were listed", () => {
    const clip = findVideo("0494");
    expect(clip.annotated).toContain("anger");
    // The three probed emotions must be a subset of the full annotation.
    for (const emotion of clip.emotions) {
      expect(clip.annotated).toContain(emotion);
    }
  });

  it("every set holds eight clips that all exist in the catalog", () => {
    expect(VIDEO_SETS).toHaveLength(5);
    for (const set of VIDEO_SETS) {
      expect(set.videoIds).toHaveLength(VIDEOS_PER_SET);
      expect(new Set(set.videoIds).size).toBe(VIDEOS_PER_SET);
      expect(() => videosInSet(set)).not.toThrow();
    }
  });

  it("rejects an unknown clip id rather than rendering a broken player", () => {
    expect(() => findVideo("9999")).toThrow(/Unknown stimulus video/);
  });
});

describe("set assignment", () => {
  it("gives both members of a dyad the same set", () => {
    // The two lab machines never talk to each other: each derives the set from
    // the Dyad ID typed on its own participant form.
    const left = assignSet("D104");
    const right = assignSet("D104");
    expect(left.id).toBe(right.id);
  });

  it("ignores case and surrounding whitespace in the Dyad ID", () => {
    expect(assignSet(" d104 ").id).toBe(assignSet("D104").id);
  });

  it("reaches all five sets across many dyads", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(assignSet(`D${i}`).id);
    expect(seen.size).toBe(VIDEO_SETS.length);
  });

  it("spreads dyads roughly evenly across the five sets", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const id = assignSet(`dyad-${i}`).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // A perfectly uniform draw gives 200 each. Allow a wide band — this guards
    // against a degenerate hash, not against ordinary sampling noise.
    for (const set of VIDEO_SETS) {
      expect(counts.get(set.id) ?? 0).toBeGreaterThan(120);
      expect(counts.get(set.id) ?? 0).toBeLessThan(280);
    }
  });

  it("still assigns a set when the Dyad ID is blank", () => {
    expect(VIDEO_SETS.map((s) => s.id)).toContain(assignSet("").id);
  });
});

describe("clip source resolution", () => {
  it("falls back to the bundled clips when no stimulus folder is set", () => {
    expect(resolveVideoSrc("1615", null)).toBe("/videos/1615.mp4");
  });

  it("falls back to the bundled clips outside Tauri even with a folder set", () => {
    // A plain browser cannot read the Research Drive; silently serving the
    // bundled copy keeps `npm run dev` working.
    expect(resolveVideoSrc("1615", "C:\\stimuli")).toBe("/videos/1615.mp4");
  });

  it("joins folder and filename with the separator the folder already uses", () => {
    expect(joinPath("C:\\stimuli", "1615.mp4")).toBe("C:\\stimuli\\1615.mp4");
    expect(joinPath("/Volumes/lab/stimuli", "1615.mp4")).toBe("/Volumes/lab/stimuli/1615.mp4");
  });

  it("does not double the separator when the folder ends in one", () => {
    expect(joinPath("C:\\stimuli\\", "1615.mp4")).toBe("C:\\stimuli\\1615.mp4");
    expect(joinPath("/lab/stimuli/", "1615.mp4")).toBe("/lab/stimuli/1615.mp4");
  });
});
