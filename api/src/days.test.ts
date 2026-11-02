import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const nutrition = (calories: number) => ({ carbs: 10, protein: 5, fat: 2, fiber: 1, sodium: 100, iron: 0.5, calories });
const entry = (id: string, name: string, calories = 100, meal = "lunch") => ({ id, meal, name, nutrition: nutrition(calories) });
const day = (date: string, entries: object[]) => ({ date, entries });

describe("a Member's Days", () => {
  it("a Member reads back the Day they put", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [entry("e1", "Oatmeal", 150, "breakfast")]) });

    const days = await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-03" });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-11-02", entries: [{ id: "e1", name: "Oatmeal", meal: "breakfast", nutrition: nutrition(150) }] });
  });

  it("another Member never sees my Days, and their Day on the same date is separate", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [entry("e1", "Oatmeal")]) });
    expect(await h.call(h.B, "days", { from: "2026-11-02", to: "2026-11-02" })).toEqual([]);

    await h.call(h.B, "putDay", { input: day("2026-11-02", [entry("e2", "Toast")]) });
    const [mine] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(mine.entries.map((e: { name: string }) => e.name)).toEqual(["Oatmeal"]);
  });

  it("putting a Day replaces the whole Day (last write wins)", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [entry("e1", "Oatmeal")]) });
    await h.call(h.A, "putDay", { input: day("2026-11-02", [entry("e1", "Oatmeal"), entry("e2", "Apple")]) });
    const [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(d.entries.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"]);
  });

  it("an Entry keeps its gram weight when known, and has none otherwise", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [{ ...entry("e1", "2 eggs scrambled"), grams: 122 }, entry("e2", "Apple")]) });
    const [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(d.entries[0].grams).toBe(122);
    expect(d.entries[1].grams ?? null).toBeNull();
    await expect(h.call(h.A, "putDay", { input: day("2026-11-02", [{ ...entry("e1", "x"), grams: -1 }]) })).rejects.toThrow("ValidationError");
  });

  it("an Entry keeps its amount and unit; a migrated Entry has neither", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [{ ...entry("e1", "Eggs"), amount: 1.5, unit: "serving", grams: 180 }, entry("e2", "Old")]) });
    const [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(d.entries[0]).toMatchObject({ amount: 1.5, unit: "serving", grams: 180 });
    expect(d.entries[1].amount ?? null).toBeNull();
    expect(d.entries[1].unit ?? null).toBeNull();
  });

  it("days returns only dates inside the range, oldest first", async () => {
    for (const date of ["2026-10-31", "2026-11-02", "2026-11-01", "2026-11-05"]) {
      await h.call(h.A, "putDay", { input: day(date, [entry("e", "x")]) });
    }
    const days = await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-04" });
    expect(days.map((d: { date: string }) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

describe("Members only", () => {
  it("refuses an unknown username even with a valid token", async () => {
    const stranger = { userId: "sub-x", username: "stranger" };
    await expect(h.call(stranger, "days", { from: "2026-11-01", to: "2026-11-02" })).rejects.toThrow("Forbidden");
    await expect(h.call(stranger, "putDay", { input: day("2026-11-02", [entry("e1", "x")]) })).rejects.toThrow("Forbidden");
    expect(h.db.dump()).toEqual([]);
  });
});

describe("Day validation", () => {
  const bad = async (input: object) => {
    await expect(h.call(h.A, "putDay", { input })).rejects.toThrow(/^ValidationError/);
    expect(h.db.dump()).toEqual([]);
  };

  it("refuses negative, non-finite or missing nutrient numbers", async () => {
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), nutrition: { ...nutrition(100), fat: -1 } }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), nutrition: { ...nutrition(100), carbs: "12" } }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), nutrition: { carbs: 1 } }]));
  });

  it("refuses an amount of 0 or less, over 100 (over 5000 in g), or a bad unit", async () => {
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 0, unit: "serving" }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 101, unit: "serving" }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 5001, unit: "g" }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 1, unit: " " }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 1, unit: "u".repeat(31) }]));
    await bad(day("2026-11-02", [{ ...entry("e1", "x"), amount: 2 }]));
    await h.call(h.A, "putDay", { input: day("2026-11-02", [{ ...entry("e1", "x"), amount: 350, unit: "g" }]) });
  });

  it("refuses a bad date, an unknown Meal, an empty name or duplicate Entry ids", async () => {
    await bad(day("2026-02-30", [entry("e1", "x")]));
    await bad(day("2026-11-02", [entry("e1", "x", 1, "brunch")]));
    await bad(day("2026-11-02", [entry("e1", "  ")]));
    await bad(day("2026-11-02", [entry("e1", "x"), entry("e1", "y")]));
  });

  it("caps Entries per Day", async () => {
    await bad(day("2026-11-02", Array.from({ length: 201 }, (_, i) => entry(`e${i}`, "x"))));
  });
});

describe("water and weight on a Day", () => {
  it("a Day write carries Entries, water and weight together, and reads back the same", async () => {
    await h.call(h.A, "putDay", { input: { ...day("2026-11-02", [entry("e1", "Oatmeal")]), water: 3, weight: 171.4 } });
    const [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(d).toMatchObject({ entries: [{ id: "e1" }], water: 3, weight: 171.4 });
  });

  it("a Day with only water or only weight logged is still a Day", async () => {
    await h.call(h.A, "putDay", { input: { ...day("2026-11-01", []), water: 2 } });
    await h.call(h.A, "putDay", { input: { ...day("2026-11-02", []), weight: 170 } });
    const days = await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-02" });
    expect(days.map((d: { water: number | null; weight: number | null }) => [d.water, d.weight])).toEqual([[2, null], [null, 170]]);
  });

  it("clearing weight (null) leaves no weight; a later write without water drops the water", async () => {
    await h.call(h.A, "putDay", { input: { ...day("2026-11-02", []), water: 4, weight: 170 } });
    await h.call(h.A, "putDay", { input: { ...day("2026-11-02", []), water: 4, weight: null } });
    let [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect([d.water, d.weight]).toEqual([4, null]);
    await h.call(h.A, "putDay", { input: day("2026-11-02", [entry("e1", "x")]) });
    [d] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect([d.water, d.weight]).toEqual([null, null]);
  });

  it("refuses fractional or negative cups, and a weight of 0 or less (0 used to mean not logged)", async () => {
    for (const extra of [{ water: 1.5 }, { water: -1 }, { weight: 0 }, { weight: -3 }, { weight: 2001 }]) {
      await expect(h.call(h.A, "putDay", { input: { ...day("2026-11-02", []), ...extra } })).rejects.toThrow(/^ValidationError/);
    }
    expect(h.db.dump()).toEqual([]);
  });
});
