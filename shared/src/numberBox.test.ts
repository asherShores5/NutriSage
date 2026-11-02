import { describe, expect, it } from "vitest";
import { readNumberBox } from "./numberBox";

describe("readNumberBox (a typed number box: blank, or a number 0 or more)", () => {
  it("reads a number, trimming spaces; a comma works as the decimal point", () => {
    expect(readNumberBox(" 12.5 ", 0)).toBe(12.5);
    expect(readNumberBox("0,4", 0)).toBe(0.4);
    expect(readNumberBox("0", null)).toBe(0);
  });

  it("gives the caller's blank value for an empty box", () => {
    expect(readNumberBox("  ", 0)).toBe(0);
    expect(readNumberBox("", null)).toBeNull();
  });

  it("is undefined for anything else: words, negatives, Infinity", () => {
    expect(readNumberBox("abc", 0)).toBeUndefined();
    expect(readNumberBox("-3", 0)).toBeUndefined();
    expect(readNumberBox("Infinity", null)).toBeUndefined();
    expect(readNumberBox("1e400", 0)).toBeUndefined();
  });
});
