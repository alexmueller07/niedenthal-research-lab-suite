import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMOTIONS_PER_VIDEO,
  ROUNDS_WITH_SETS,
  STUDY_EMOTIONS,
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
  it("holds the forty clips Ben grouped", () => {
    expect(VIDEO_CATALOG).toHaveLength(ROUNDS_WITH_SETS * VIDEOS_PER_SET);
    expect(VIDEO_CATALOG).toHaveLength(40);
  });

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

  // The emotion word goes straight into the question ("To what extent did you
  // feel <emotion> while watching this video?"), so a stray capital or a word
  // from outside the study's vocabulary is a participant-visible typo.
  it("only asks about the study's twelve emotions, in lower case", () => {
    const allowed = new Set<string>(STUDY_EMOTIONS);
    for (const video of VIDEO_CATALOG) {
      for (const emotion of video.emotions) {
        expect(emotion).toBe(emotion.toLowerCase());
        expect(allowed.has(emotion), `${video.id}: "${emotion}"`).toBe(true);
      }
    }
  });

  it("names every clip with the four-digit stem its file uses", () => {
    for (const video of VIDEO_CATALOG) {
      expect(video.id).toMatch(/^\d{4}$/);
    }
  });

  it("rejects an unknown clip id rather than rendering a broken player", () => {
    expect(() => findVideo("9999")).toThrow(/Unknown stimulus video/);
  });
});

describe("the clip files themselves", () => {
  // The catalog is a list of filenames. A clip in it with no file behind it is
  // a black rectangle in the middle of a session, and nothing before this test
  // would notice: TypeScript is happy, the build is happy, and the task only
  // fails when a participant reaches that trial. Since 2026-09-21 the clips
  // ship inside the installer, so this can simply be checked.
  it("ships an mp4 for every clip in the catalog", () => {
    const missing = VIDEO_CATALOG.map((v) => v.id).filter(
      (id) => !existsSync(join(process.cwd(), "public", "videos", `${id}.mp4`))
    );
    expect(missing).toEqual([]);
  });
});

describe("video sets", () => {
  it("every set holds eight clips that all exist in the catalog", () => {
    expect(VIDEO_SETS).toHaveLength(5);
    for (const set of VIDEO_SETS) {
      expect(set.videoIds).toHaveLength(VIDEOS_PER_SET);
      expect(new Set(set.videoIds).size).toBe(VIDEOS_PER_SET);
      expect(() => videosInSet(set)).not.toThrow();
    }
  });

  // This is the property the whole round-to-group rule exists for: a
  // participant does five rounds and must not meet the same clip twice.
  it("never puts the same clip in two groups", () => {
    const all = VIDEO_SETS.flatMap((s) => s.videoIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("names the groups the way the data file will", () => {
    expect(VIDEO_SETS.map((s) => s.id)).toEqual([
      "GROUP_1",
      "GROUP_2",
      "GROUP_3",
      "GROUP_4",
      "GROUP_5",
    ]);
  });
});

describe("set assignment", () => {
  it("gives round N group N", () => {
    for (let round = 1; round <= ROUNDS_WITH_SETS; round += 1) {
      expect(assignSet(round).id).toBe(`GROUP_${round}`);
    }
  });

  // Two people rating the same clips is what makes their ratings comparable,
  // and with this rule it follows from them being on the same round rather
  // than from the two machines agreeing about anything.
  it("gives two participants on the same round the same clips", () => {
    expect(assignSet(3).videoIds).toEqual(assignSet(3).videoIds);
    expect(assignSet(3).id).toBe(assignSet(3).id);
  });

  it("gives a participant a different group on every one of their five rounds", () => {
    const seen = new Set<string>();
    for (let round = 1; round <= ROUNDS_WITH_SETS; round += 1) {
      seen.add(assignSet(round).id);
    }
    expect(seen.size).toBe(ROUNDS_WITH_SETS);
  });

  // A sixth round is outside the protocol, but a session that reaches one has
  // to keep running rather than crash in front of a participant.
  it("wraps rather than failing past the last group", () => {
    expect(assignSet(6).id).toBe("GROUP_1");
    expect(assignSet(11).id).toBe("GROUP_1");
  });

  it("falls back to the first group for a round that is not a round", () => {
    expect(assignSet(0).id).toBe("GROUP_1");
    expect(assignSet(-2).id).toBe("GROUP_1");
    expect(assignSet(Number.NaN).id).toBe("GROUP_1");
  });
});

describe("the two halves of the TikTok task", () => {
  // Ben, 2026-09-21, after testing the app: "the whole thing (rating emotions
  // and me/my partner would enjoy) is the TikTok task, I think the language was
  // meant to imply that both parts of the task should have the same videos
  // within-rounds."
  //
  // Both halves are drawn from the same `assignSet(round)` inside VideoTaskMain,
  // so what has to hold is that the round alone decides the clip list — ask
  // twice for the same round and you get the same eight, whatever order they
  // are then shuffled into.
  it("gives the rating trials and the sharing page the same eight clips", () => {
    for (let round = 1; round <= ROUNDS_WITH_SETS; round += 1) {
      const trials = assignSet(round).videoIds;
      const sharing = assignSet(round).videoIds;
      expect([...sharing].sort()).toEqual([...trials].sort());
    }
  });

  it("never shows a round the clips of another round", () => {
    for (let a = 1; a <= ROUNDS_WITH_SETS; a += 1) {
      for (let b = a + 1; b <= ROUNDS_WITH_SETS; b += 1) {
        const overlap = assignSet(a).videoIds.filter((id) =>
          assignSet(b).videoIds.includes(id)
        );
        expect(overlap, `rounds ${a} and ${b} share clips`).toEqual([]);
      }
    }
  });
});

describe("clip source resolution", () => {
  it("falls back to the bundled clips when no stimulus folder is set", () => {
    expect(resolveVideoSrc("0014", null)).toBe("/videos/0014.mp4");
  });

  it("falls back to the bundled clips outside Tauri even with a folder set", () => {
    // A plain browser cannot read a local library; serving the bundled copy
    // keeps `npm run dev` working.
    expect(resolveVideoSrc("0014", "C:\\stimuli")).toBe("/videos/0014.mp4");
  });

  it("joins folder and filename with the separator the folder already uses", () => {
    expect(joinPath("C:\\stimuli", "0014.mp4")).toBe("C:\\stimuli\\0014.mp4");
    expect(joinPath("/Volumes/lab/stimuli", "0014.mp4")).toBe("/Volumes/lab/stimuli/0014.mp4");
  });

  it("does not double the separator when the folder ends in one", () => {
    expect(joinPath("C:\\stimuli\\", "0014.mp4")).toBe("C:\\stimuli\\0014.mp4");
    expect(joinPath("/lab/stimuli/", "0014.mp4")).toBe("/lab/stimuli/0014.mp4");
  });
});
