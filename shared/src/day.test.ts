import { describe, expect, it } from "vitest";
import { MEALS, MEAL_LABELS, dateKey, entriesByMeal, isDateKey, mergeDays, moveEntry, shiftDate, dayLabel, weightLabel, type Day, type Entry } from "./day";

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

describe("moveEntry", () => {
  const n = (calories: number) => ({ carbs: 1, protein: 2, fat: 3, fiber: 4, sodium: 5, iron: 6, calories });
  const lunch = { id: "e1", meal: "lunch" as const, name: "Burrito bowl", nutrition: n(680), grams: 450 };
  const apple = { id: "e2", meal: "snack" as const, name: "Apple", nutrition: n(95) };
  const today = { date: "2026-11-02", entries: [lunch, apple], water: 3, weight: 171.4, updatedAt: 5 };

  it("to another Meal on the same Day changes only its Meal, keeping its place", () => {
    const r = moveEntry(today, "e1", { meal: "dinner" });
    expect(r).toEqual([{ ...today, entries: [{ ...lunch, meal: "dinner" }, apple] }]);
  });

  it("to another Day takes it off this Day and adds it to the end of that Day, amount and snapshot unchanged", () => {
    const yesterday = { date: "2026-11-01", entries: [apple], water: 8, weight: null };
    const [from, to] = moveEntry(today, "e1", { date: "2026-11-01" }, yesterday);
    expect(from).toEqual({ ...today, entries: [apple] });
    expect(to).toEqual({ ...yesterday, entries: [apple, lunch] });
  });

  it("to an unlogged Day starts that Day with just the Entry, and can change the Meal too", () => {
    const [, to] = moveEntry(today, "e1", { date: "2026-10-30", meal: "breakfast" });
    expect(to).toEqual({ date: "2026-10-30", entries: [{ ...lunch, meal: "breakfast" }], water: null, weight: null });
  });

  it("an unknown Entry or a move to where it already is changes nothing", () => {
    expect(moveEntry(today, "nope", { meal: "dinner" })).toEqual([]);
    expect(moveEntry(today, "e1", { meal: "lunch", date: "2026-11-02" })).toEqual([]);
  });

  it("refuses a date that isn't YYYY-MM-DD", () => {
    expect(() => moveEntry(today, "e1", { date: "11/01/2026" })).toThrow("date");
  });
});

describe("Day navigation", () => {
  it("shiftDate steps whole calendar days across month and year ends", () => {
    expect(shiftDate("2026-11-02", -1)).toBe("2026-11-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    // The US clock change (Nov 1 2026) doesn't skip or repeat a Day.
    expect(shiftDate("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("dayLabel names today, yesterday and tomorrow, and spells out other dates", () => {
    const today = "2026-11-02";
    expect(dayLabel("2026-11-02", today)).toBe("Today");
    expect(dayLabel("2026-11-01", today)).toBe("Yesterday");
    expect(dayLabel("2026-11-03", today)).toBe("Tomorrow");
    expect(dayLabel("2026-10-28", today)).toBe("Wed, Oct 28");
    expect(dayLabel("2025-12-25", today)).toBe("Thu, Dec 25, 2025");
  });
});

describe("mergeDays (a Day changed here from an older copy, or none, meets the server's newer copy)", () => {
  const n = { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 100 };
  const entry = (id: string, name: string) => ({ id, meal: "lunch" as const, name, nutrition: n });
  const day = (entries: Entry[], water: number | null = null, weight: number | null = null): Day => ({ date: "2026-11-02", entries, water, weight });
  const names = (d: Day) => d.entries.map((e) => e.name);

  it("started here without the server's copy: keeps every Entry from both, the server's first", () => {
    const server = day([entry("d1", "Desk almonds")], 3, 170);
    const local = day([entry("p1", "Phone banana")]);
    expect(mergeDays(local, server, undefined)).toMatchObject({ entries: [{ name: "Desk almonds" }, { name: "Phone banana" }], water: 3, weight: 170 });
  });

  it("from an older copy: adds what each side added, drops what each side deleted", () => {
    const base = day([entry("a", "Toast"), entry("b", "Tea")]);
    const server = day([entry("a", "Toast"), entry("d", "Desk almonds")]); // the desktop deleted Tea, added almonds
    const local = day([entry("b", "Tea"), entry("p", "Phone pear")]); // the phone deleted Toast, added a pear
    expect(names(mergeDays(local, server, base))).toEqual(["Desk almonds", "Phone pear"]);
  });

  it("an Entry changed on one side keeps that change", () => {
    const base = day([entry("a", "Toast"), entry("b", "Tea")]);
    const server = day([entry("a", "Toast, 2 slices"), entry("b", "Tea")]);
    const local = day([entry("a", "Toast"), entry("b", "Green tea")]);
    expect(names(mergeDays(local, server, base))).toEqual(["Toast, 2 slices", "Green tea"]);
  });

  it("water and weight: this device's value when it changed them, else the server's", () => {
    const base = day([], 2, 170);
    expect(mergeDays(day([], 4, 170), day([], 3, 171), base)).toMatchObject({ water: 4, weight: 171 });
    expect(mergeDays(day([], null, 168.5), day([], 5, null), undefined)).toMatchObject({ water: 5, weight: 168.5 });
  });

  it("is the local copy as is when the server has no Day", () => {
    const local = day([entry("p1", "Phone banana")], 2);
    expect(mergeDays(local, undefined, undefined)).toEqual(local);
  });
});

describe("weightLabel (the weight box names the Day shown)", () => {
  it("says today's, yesterday's or the date", () => {
    expect(weightLabel("2026-11-02", "2026-11-02")).toBe("Today's weight");
    expect(weightLabel("2026-11-01", "2026-11-02")).toBe("Yesterday's weight");
    expect(weightLabel("2026-10-28", "2026-11-02")).toBe("Weight on Wed, Oct 28");
  });
});
