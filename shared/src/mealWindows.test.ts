import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_WINDOWS, guessMeal, mealWindowRanges, validateMealWindows } from "./mealWindows";

/** A local-time Date on an arbitrary day at HH:MM. */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 10, 2, h, m, 0, 0);
};

describe("guessMeal with the default Meal windows", () => {
  const cases: [string, string][] = [
    ["00:00", "breakfast"], ["07:15", "breakfast"], ["10:29", "breakfast"],
    ["10:30", "lunch"], ["14:29", "lunch"],
    ["14:30", "snack"], ["16:59", "snack"],
    ["17:00", "dinner"], ["20:29", "dinner"],
    ["20:30", "dessert"], ["23:59", "dessert"],
  ];
  for (const [time, meal] of cases) {
    it(`${time} is ${meal}`, () => expect(guessMeal(DEFAULT_MEAL_WINDOWS, at(time))).toBe(meal));
  }

  it("ignores seconds: 10:29:59 is still breakfast", () => {
    const d = at("10:29");
    d.setSeconds(59, 999);
    expect(guessMeal(DEFAULT_MEAL_WINDOWS, d)).toBe("breakfast");
  });
});

describe("guessMeal with custom Meal windows", () => {
  const nightShift = { breakfast: "13:00", lunch: "18:00", snack: "21:00", dinner: "01:00", dessert: "05:00" };

  it("uses the Member's own start times", () => {
    expect(guessMeal(nightShift, at("13:00"))).toBe("breakfast");
    expect(guessMeal(nightShift, at("17:59"))).toBe("breakfast");
    expect(guessMeal(nightShift, at("18:00"))).toBe("lunch");
    expect(guessMeal(nightShift, at("02:00"))).toBe("dinner");
    expect(guessMeal(nightShift, at("06:00"))).toBe("dessert");
  });

  it("before the earliest start, the Meal that started last yesterday still runs (wraps past midnight)", () => {
    expect(guessMeal(nightShift, at("00:30"))).toBe("snack");
    expect(guessMeal(nightShift, at("12:59"))).toBe("dessert");
  });

  it("a later breakfast pushes the early hours into dessert", () => {
    const late = { ...DEFAULT_MEAL_WINDOWS, breakfast: "05:00" };
    expect(guessMeal(late, at("04:59"))).toBe("dessert");
    expect(guessMeal(late, at("05:00"))).toBe("breakfast");
  });
});

describe("mealWindowRanges", () => {
  it("lists each Meal from its start until the next Meal starts, in time order", () => {
    expect(mealWindowRanges(DEFAULT_MEAL_WINDOWS)).toEqual([
      { meal: "breakfast", start: "00:00", end: "10:30" },
      { meal: "lunch", start: "10:30", end: "14:30" },
      { meal: "snack", start: "14:30", end: "17:00" },
      { meal: "dinner", start: "17:00", end: "20:30" },
      { meal: "dessert", start: "20:30", end: "00:00" },
    ]);
  });
});

describe("validateMealWindows", () => {
  it("accepts the defaults and returns a clean copy", () => {
    const r = validateMealWindows({ ...DEFAULT_MEAL_WINDOWS, extra: "x" });
    expect(r).toEqual({ ok: true, windows: DEFAULT_MEAL_WINDOWS });
  });

  it("refuses a missing Meal, a bad time, or two Meals starting at once", () => {
    const { lunch: _l, ...noLunch } = DEFAULT_MEAL_WINDOWS;
    expect(validateMealWindows(noLunch)).toEqual({ ok: false, error: "Lunch needs a start time (HH:MM)" });
    expect(validateMealWindows({ ...DEFAULT_MEAL_WINDOWS, dinner: "25:00" })).toEqual({ ok: false, error: "Dinner needs a start time (HH:MM)" });
    expect(validateMealWindows({ ...DEFAULT_MEAL_WINDOWS, snack: "2:30" }).ok).toBe(false);
    expect(validateMealWindows({ ...DEFAULT_MEAL_WINDOWS, snack: 870 }).ok).toBe(false);
    expect(validateMealWindows({ ...DEFAULT_MEAL_WINDOWS, dessert: "17:00" })).toEqual({ ok: false, error: "Dinner and Dessert can't start at the same time" });
    expect(validateMealWindows(null).ok).toBe(false);
  });
});
