import { describe, expect, it } from "vitest";
import { fileStem, identifierWarning, sanitizeCode, timestamp } from "./naming";

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

describe("fileStem", () => {
  const when = new Date(2026, 7, 11, 14, 3, 12);

  it("appends a timestamp so two takes never collide", () => {
    expect(fileStem("dyad-014", when)).toBe("dyad-014_20260811-140312");
  });

  it("still produces a usable name with no code entered", () => {
    expect(fileStem("", when)).toBe("session_20260811-140312");
  });

  it("pads every field to a fixed width so names sort chronologically", () => {
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("identifierWarning", () => {
  it("catches an email address", () => {
    expect(identifierWarning("student@wisc.edu")).toMatch(/email/i);
  });

  it("catches something shaped like a person's name", () => {
    expect(identifierWarning("Jane Doe")).toMatch(/name/i);
  });

  it("stays quiet for ordinary session codes", () => {
    expect(identifierWarning("dyad-014")).toBeNull();
    expect(identifierWarning("room2_take1")).toBeNull();
    expect(identifierWarning("")).toBeNull();
  });

  it("does not fire on a code that merely contains capitals", () => {
    expect(identifierWarning("PPS2026")).toBeNull();
    expect(identifierWarning("Room 2")).toBeNull();
  });
});
