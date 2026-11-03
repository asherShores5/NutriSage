import { describe, expect, it } from "vitest";
import { cupsAfterTap, cupsShown, readWeight } from "./waterWeight";

describe("water cups", () => {
  it("tapping cup N sets water to N cups; tapping the top filled cup takes one off", () => {
    expect(cupsAfterTap(0, 0)).toBe(1);
    expect(cupsAfterTap(2, 4)).toBe(5);
    expect(cupsAfterTap(5, 4)).toBe(4);
    expect(cupsAfterTap(5, 1)).toBe(2);
  });

  it("shows at least the goal's worth of cups, plus any over the goal", () => {
    expect(cupsShown(3, 8)).toBe(8);
    expect(cupsShown(10, 8)).toBe(10);
    expect(cupsShown(0, 0)).toBe(1);
  });
});

describe("readWeight (the once-per-Day weight box)", () => {
  it("reads a positive number", () => {
    expect(readWeight(" 171.4 ")).toEqual({ ok: true, weight: 171.4 });
  });

  it("refuses blank, zero, negative, junk or absurd weights with a message", () => {
    for (const t of ["", "0", "-5", "abc", "2001"]) {
      expect(readWeight(t)).toEqual({ ok: false, error: "Weight must be a number from 0.1 to 2000" });
    }
  });
});
