import { describe, expect, it } from "vitest";

import { describeVideo } from "./api";
import type { DyadVideo } from "./api";

function video(overrides: Partial<DyadVideo> = {}): DyadVideo {
  return {
    path: "R:/niedenthal/recordings/dyad-014/dyad-014_20260924-140312.mp4",
    fileName: "dyad-014_20260924-140312.mp4",
    bytes: 883_000_000,
    modifiedAt: Math.floor(new Date(2026, 8, 24, 14, 3, 12).getTime() / 1000),
    recordingId: "dyadvid-0123456789abcdef",
    ...overrides,
  };
}

describe("describeVideo", () => {
  it("leads with the filename, which is what an RA can check against the room log", () => {
    expect(describeVideo(video())).toContain("dyad-014_20260924-140312.mp4");
  });

  it("gives the size in MB, so a half-copied file is visible as one", () => {
    expect(describeVideo(video())).toContain("842 MB");
  });

  it("says nothing about size when the file reports none", () => {
    expect(describeVideo(video({ bytes: 0 }))).not.toContain("MB");
  });

  it("survives a file whose timestamp could not be read", () => {
    // modifiedAt is 0 when the filesystem would not say. Still a real date,
    // still rendered — never the string "Invalid Date" on an RA's screen.
    const described = describeVideo(video({ modifiedAt: 0 }));
    expect(described).not.toContain("Invalid Date");
    expect(described).toContain("dyad-014_20260924-140312.mp4");
  });
});
