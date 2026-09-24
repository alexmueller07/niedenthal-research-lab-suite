import { describe, expect, it } from "vitest";
import {
  dyadFolder,
  fileStem,
  normalizeDyadId,
  sanitizeCode,
  timestamp,
  isNetworkPath,
} from "./naming";

describe("sanitizeCode", () => {
  it("keeps the characters a session code actually uses", () => {
    expect(sanitizeCode("dyad-014_room2.take1")).toBe("dyad-014_room2.take1");
  });

  it("replaces spaces and path separators rather than producing a broken path", () => {
    expect(sanitizeCode("dyad 14/room 2")).toBe("dyad-14-room-2");
    expect(sanitizeCode("a\\b:c*d")).toBe("a-b-c-d");
  });

  it("collapses runs and trims edges so names stay readable", () => {
    expect(sanitizeCode("  --dyad---14--  ")).toBe("dyad-14");
  });

  it("caps length so a pasted paragraph cannot blow the path limit", () => {
    expect(sanitizeCode("x".repeat(200))).toHaveLength(60);
  });

  it("returns empty for input with nothing usable in it", () => {
    expect(sanitizeCode("   ")).toBe("");
    expect(sanitizeCode("///")).toBe("");
  });
});

describe("normalizeDyadId", () => {
  it("pads to the three digits everything downstream spells it with", () => {
    expect(normalizeDyadId("14")).toBe("014");
    expect(normalizeDyadId("014")).toBe("014");
    expect(normalizeDyadId("  14  ")).toBe("014");
  });

  it("reads the dyad out of the old free-text code, typed from habit", () => {
    // "dyad-014-room2" is dyad 14 in room 2, not dyad 142.
    expect(normalizeDyadId("dyad-014-room2")).toBe("014");
    expect(normalizeDyadId("dyad 14")).toBe("014");
    expect(normalizeDyadId("#7")).toBe("007");
  });

  it("does not truncate a lab that gets past dyad 999", () => {
    expect(normalizeDyadId("1042")).toBe("1042");
  });

  it("is empty when there is no number in it at all", () => {
    expect(normalizeDyadId("")).toBe("");
    expect(normalizeDyadId("  ")).toBe("");
    expect(normalizeDyadId("pilot")).toBe("");
  });
});

describe("dyadFolder", () => {
  it("is the folder both ends of the pipeline agree on", () => {
    expect(dyadFolder("14")).toBe("dyad-014");
    expect(dyadFolder("014")).toBe("dyad-014");
  });

  it("files a take with no dyad somewhere findable rather than nowhere", () => {
    expect(dyadFolder("")).toBe("unfiled");
  });
});

describe("fileStem", () => {
  const when = new Date(2026, 7, 11, 14, 3, 12);

  it("names the file after the dyad, however the RA typed it", () => {
    expect(fileStem("14", when)).toBe("dyad-014_20260811-140312");
    expect(fileStem("014", when)).toBe("dyad-014_20260811-140312");
  });

  it("appends a timestamp so two takes of one dyad never collide", () => {
    const later = new Date(2026, 7, 11, 14, 40, 0);
    expect(fileStem("14", when)).not.toBe(fileStem("14", later));
  });

  it("still produces a usable name with nothing entered", () => {
    expect(fileStem("", when)).toBe("session_20260811-140312");
  });

  it("pads every field to a fixed width so names sort chronologically", () => {
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("isNetworkPath", () => {
  it("recognises a UNC path", () => {
    // The Research Drive as the README tells RAs to enter it.
    expect(isNetworkPath(String.raw`\\research.drive.wisc.edu\niedenthal\recordings`)).toBe(true);
  });

  it("recognises the mapped letters the Research Drive gets", () => {
    // Room B had the working folder on Z:\UW_Fall2026 (2026-09-11).
    expect(isNetworkPath(String.raw`Z:\UW_Fall2026`)).toBe(true);
    expect(isNetworkPath(String.raw`R:\niedenthal\recordings`)).toBe(true);
    expect(isNetworkPath("z:/lowercase/too")).toBe(true);
  });

  it("leaves the local disks alone", () => {
    // D: is where Room C writes, and it is a local disk.
    expect(isNetworkPath(String.raw`C:\Users\Niedenthal Lab\captures`)).toBe(false);
    expect(isNetworkPath(String.raw`D:\Fall 2026 Test`)).toBe(false);
    expect(isNetworkPath("D:/forward/slashes")).toBe(false);
  });

  it("says nothing about an empty or relative path", () => {
    expect(isNetworkPath("")).toBe(false);
    expect(isNetworkPath("   ")).toBe(false);
    expect(isNetworkPath("captures")).toBe(false);
  });
});
