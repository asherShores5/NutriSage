import { describe, expect, it } from "vitest";
import { NUTRIENTS, NUTRIENT_KEYS, num, pct, sumMacros } from "./nutrients";

const ZERO = { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 0 };

describe("the nutrient list", () => {
  it("tracks carbs, protein, fat, fiber (g), sodium, iron (mg) and calories, in that order", () => {
    expect(NUTRIENT_KEYS).toEqual(["carbs", "protein", "fat", "fiber", "sodium", "iron", "calories"]);
    expect(Object.fromEntries(NUTRIENTS.map((n) => [n.key, n.unit]))).toEqual({
      carbs: "g", protein: "g", fat: "g", fiber: "g", sodium: "mg", iron: "mg", calories: "cal",
    });
  });
});

describe("num", () => {
  it("coerces junk to 0 and keeps real numbers", () => {
    expect(num("12")).toBe(12);
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(3.5)).toBe(3.5);
    expect(num(NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
  });
});

describe("sumMacros", () => {
  it("adds up each nutrient across Entries, tolerating missing and non-numeric fields", () => {
    expect(
      sumMacros([
        { nutrition: { carbs: 10, protein: 5, fat: 2, fiber: 1, sodium: 100, iron: 1.5, calories: 80 } },
        { nutrition: { carbs: "4", protein: "x", fat: undefined, calories: 20 } },
        { nutrition: undefined },
        null,
      ]),
    ).toEqual({ carbs: 14, protein: 5, fat: 2, fiber: 1, sodium: 100, iron: 1.5, calories: 100 });
  });

  it("is all zeros for no Entries", () => {
    expect(sumMacros([])).toEqual(ZERO);
    expect(sumMacros(null)).toEqual(ZERO);
  });
});

describe("pct", () => {
  it("is the share of the goal, clamped to 100, and 0 with no goal", () => {
    expect(pct(50, 100)).toBe(50);
    expect(pct(150, 100)).toBe(100);
    expect(pct(50, 0)).toBe(0);
    expect(pct(50, undefined)).toBe(0);
  });
});
