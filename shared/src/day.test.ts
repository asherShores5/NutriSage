import { describe, expect, it } from "vitest";
import { MEALS, MEAL_LABELS, dateKey, entriesByMeal, isDateKey } from "./day";

describe("Meals", () => {
  it("are Breakfast, Lunch, Dinner, Dessert, Snack, in display order", () => {
    expect(MEALS.map((m) => MEAL_LABELS[m])).toEqual(["Breakfast", "Lunch", "Dinner", "Dessert", "Snack"]);
  });

  it("group a Day's Entries in display order, keeping each Meal's logging order and skipping empty Meals", () => {
    const e = (id: string, meal: string) => ({ id, meal });
    const groups = entriesByMeal([e("1", "snack"), e("2", "breakfast"), e("3", "snack"), e("4", "dessert")] as never);
    expect(groups.map(([meal, list]) => [meal, list.map((x) => x.id)])).toEqual([
      ["breakfast", ["2"]],
      ["dessert", ["4"]],
      ["snack", ["1", "3"]],
    ]);
  });
});

describe("dateKey", () => {
  it("is the local calendar date as YYYY-MM-DD", () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 10, 2, 0, 1))).toBe("2026-11-02");
  });

  it("isDateKey accepts only real YYYY-MM-DD dates", () => {
    expect(isDateKey("2026-11-02")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-1-2")).toBe(false);
    expect(isDateKey("DAY#2026-11-02")).toBe(false);
  });
});
