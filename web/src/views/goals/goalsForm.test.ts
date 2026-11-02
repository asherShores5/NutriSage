import { describe, expect, it } from "vitest";
import { goalsToForm, readGoalsForm } from "./goalsForm";

const GOALS = { carbs: 250, protein: 160, fat: 75, fiber: 35, sodium: 2300, iron: 8, calories: 2400, water: 10 };

describe("the Goals form", () => {
  it("shows each goal, with no goal (0) as a blank box", () => {
    expect(goalsToForm({ ...GOALS, iron: 0 })).toEqual({ carbs: "250", protein: "160", fat: "75", fiber: "35", sodium: "2300", iron: "", calories: "2400", water: "10" });
  });

  it("reads every target back; a blank box means no goal", () => {
    expect(readGoalsForm({ ...goalsToForm(GOALS), iron: " ", calories: "2000" })).toEqual({ ok: true, goals: { ...GOALS, iron: 0, calories: 2000 } });
  });

  it("refuses a negative or non-numeric target, naming it", () => {
    expect(readGoalsForm({ ...goalsToForm(GOALS), fat: "-1" })).toEqual({ ok: false, error: "Fat goal must be a number, 0 or more" });
    expect(readGoalsForm({ ...goalsToForm(GOALS), water: "lots" })).toEqual({ ok: false, error: "Water goal must be a number, 0 or more" });
  });

  it("refuses a fractional water goal (cups are whole)", () => {
    expect(readGoalsForm({ ...goalsToForm(GOALS), water: "6.5" })).toEqual({ ok: false, error: "Water goal must be a whole number of cups" });
  });
});
