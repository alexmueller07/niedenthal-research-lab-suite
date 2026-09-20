import { describe, expect, it } from "vitest";
import { isAdvanceClick, isAdvanceKey } from "./useAdvance";

// The filters behind "press any key or click continue". Both of them exist to
// stop an advance that the participant did not ask for, and both were bugs
// before they were rules — a held-down space bar used to walk through every
// instruction screen at once.

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    repeat: false,
    target: { tagName: "DIV", isContentEditable: false, closest: () => null },
    ...init,
  } as unknown as KeyboardEvent;
}

function clickEvent(target: unknown): MouseEvent {
  return { target } as unknown as MouseEvent;
}

/** A DOM-ish element whose closest() answers for a given selector match. */
function element(tagName: string, insideControl: boolean) {
  return {
    tagName,
    isContentEditable: false,
    closest: () => (insideControl ? {} : null),
  };
}

describe("isAdvanceKey", () => {
  it("accepts an ordinary keypress", () => {
    expect(isAdvanceKey(keyEvent({ key: " " }))).toBe(true);
    expect(isAdvanceKey(keyEvent({ key: "Enter" }))).toBe(true);
    expect(isAdvanceKey(keyEvent({ key: "a" }))).toBe(true);
  });

  it("ignores a held key repeating", () => {
    expect(isAdvanceKey(keyEvent({ key: " ", repeat: true }))).toBe(false);
  });

  it("ignores a lone modifier", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta"]) {
      expect(isAdvanceKey(keyEvent({ key }))).toBe(false);
    }
  });

  it("leaves typing in a text field to the text field", () => {
    expect(
      isAdvanceKey(keyEvent({ key: "a", target: element("INPUT", false) }))
    ).toBe(false);
    expect(
      isAdvanceKey(keyEvent({ key: "a", target: element("TEXTAREA", false) }))
    ).toBe(false);
  });
});

describe("isAdvanceClick", () => {
  it("accepts a click on the page background", () => {
    expect(isAdvanceClick(clickEvent(element("DIV", false)))).toBe(true);
  });

  // Otherwise "← Previous" would go back a screen and immediately forward
  // again, and Continue would advance twice.
  it("leaves a click on a control to that control", () => {
    expect(isAdvanceClick(clickEvent(element("BUTTON", true)))).toBe(false);
  });

  it("treats a click with no target as a background click", () => {
    expect(isAdvanceClick(clickEvent(null))).toBe(true);
  });
});
