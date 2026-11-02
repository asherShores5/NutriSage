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
