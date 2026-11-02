import { describe, expect, it } from "vitest";
import { barGroups, barState, energyBalance } from "./bars";

// Cases ported from the old docs/macros.test.js (GitHub main 13e8f12).
describe("barState (one nutrient against its own goal)", () => {
  it("is blank with no goal, good within 10% of goal, over past 110%, blank when under", () => {
    expect(barState("sodium", 100, 0)).toBe("");
    expect(barState("sodium", 100, 100)).toBe("good");
    expect(barState("sodium", 130, 100)).toBe("over");
    expect(barState("sodium", 80, 100)).toBe("");
  });

  it("protein and fiber are good from 90% of goal up, never over", () => {
    expect(barState("protein", 95, 100)).toBe("good");
    expect(barState("protein", 200, 100)).toBe("good");
    expect(barState("fiber", 50, 100)).toBe("");
  });
});

describe("energyBalance (carbs and fat as one shared energy pool)", () => {
  const goals = { carbs: 200, fat: 60 }; // pool 200*4 + 60*9 = 1340 cal

  it("both on goal: both good, nothing swapped", () => {
    const e = energyBalance({ carbs: 200, fat: 60 }, goals);
    expect(e.carbs.state).toBe("good");
    expect(e.fat.state).toBe("good");
    expect(e.fat.spillCal).toBe(0);
  });

  it("fat over its grams but the pool on target: fat spills 180 cal, carbs good", () => {
    const e = energyBalance({ carbs: 155, fat: 80 }, goals);
    expect(e.fat).toEqual({ state: "spill", spillCal: 180, partner: "carbs" });
    expect(e.carbs).toEqual({ state: "good", spillCal: 0, partner: "fat" });
  });

  it("fat over and the pool over: fat is a real overage, carbs good", () => {
    const e = energyBalance({ carbs: 200, fat: 90 }, goals);
    expect(e.fat.state).toBe("over");
    expect(e.carbs.state).toBe("good");
  });

  it("both over with the pool over: both over", () => {
    const e = energyBalance({ carbs: 260, fat: 80 }, goals);
    expect(e.carbs.state).toBe("over");
    expect(e.fat.state).toBe("over");
  });

  it("carbs over but the pool on target: carbs spill 180 cal, fat good", () => {
    const e = energyBalance({ carbs: 245, fat: 40 }, goals);
    expect(e.carbs).toEqual({ state: "spill", spillCal: 180, partner: "fat" });
    expect(e.fat.state).toBe("good");
  });

  it("with a goal unset, each falls back to its own barState", () => {
    const e = energyBalance({ carbs: 300, fat: 80 }, { carbs: 0, fat: 60 });
    expect(e.fat.state).toBe("over");
    expect(e.carbs.state).toBe("");
    expect(e.fat.spillCal).toBe(0);
  });
});

describe("barGroups (the rows Today and Week draw)", () => {
  const goals = { carbs: 200, protein: 100, fat: 60, fiber: 30, sodium: 2000, iron: 10, calories: 2000 };
  const totals = { carbs: 155, protein: 50, fat: 80, fiber: 10, sodium: 2500, iron: 4, calories: 1500 };

  it("splits Macros (carbs, protein, fat, fiber, calories) from Micronutrients (sodium, iron)", () => {
    const groups = barGroups(totals, goals);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.key)])).toEqual([
      ["Macros", ["carbs", "protein", "fat", "fiber", "calories"]],
      ["Micronutrients", ["sodium", "iron"]],
    ]);
  });

  it("each row carries its percent, its state and the swap caption for carbs/fat", () => {
    const rows = Object.fromEntries(barGroups(totals, goals).flatMap((g) => g.rows).map((r) => [r.key, r]));
    expect(rows.fat).toMatchObject({ value: 80, goal: 60, pct: 100, state: "spill", note: "⇄ 180 cal swapped with carbs" });
    expect(rows.carbs).toMatchObject({ pct: 78, state: "good", note: "" });
    expect(rows.sodium).toMatchObject({ pct: 100, state: "over" });
    expect(rows.protein).toMatchObject({ pct: 50, state: "" });
  });

  it("junk or missing goals mean no goal: 0% and no state", () => {
    const rows = barGroups(totals, {}).flatMap((g) => g.rows);
    expect(rows.every((r) => r.goal === 0 && r.pct === 0 && r.state === "")).toBe(true);
  });
});
