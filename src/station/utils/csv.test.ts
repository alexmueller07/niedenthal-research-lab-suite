import { describe, it, expect } from "vitest";
import { csvEscape } from "./csv";

describe("csvEscape", () => {
  it("leaves a plain value untouched", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes a free-text response that contains a comma (the column-break bug)", () => {
    expect(csvEscape("I felt happy, then sad")).toBe('"I felt happy, then sad"');
  });

  it("a comma-containing field stays a single column when joined", () => {
    const row = ["7", "I felt happy, then sad", "Left"].map(csvEscape).join(",");
    // The escaped row must still split back into exactly 3 logical fields.
    expect(row).toBe('7,"I felt happy, then sad",Left');
  });

  it("doubles embedded quotes and wraps the field", () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("flattens newlines to spaces so a response stays on one row", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one line two"');
    expect(csvEscape("crlf\r\nhere")).toBe('"crlf here"');
  });
});
