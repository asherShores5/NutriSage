import { beforeEach, describe, expect, it } from "vitest";
import { moveEntry, type Day } from "@nutrisage/shared";
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

  it("days returns only dates inside the range, oldest first", async () => {
    for (const date of ["2026-10-31", "2026-11-02", "2026-11-01", "2026-11-05"]) {
      await h.call(h.A, "putDay", { input: day(date, [entry("e", "x")]) });
    }
    const days = await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-04" });
    expect(days.map((d: { date: string }) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

describe("moving an Entry", () => {
  const read = async (date: string): Promise<Day | undefined> => (await h.call(h.A, "days", { from: date, to: date }))[0];
  /** What the client does: compute the move, then put every Day it returns (destination first). */
  const move = async (date: string, id: string, to: { meal?: "dinner"; date?: string }) => {
    const target = to.date ? await read(to.date) : undefined;
    const writes = moveEntry((await read(date))!, id, to, target);
    for (const d of [...writes].reverse()) await h.call(h.A, "putDay", { input: { date: d.date, entries: d.entries, water: d.water ?? null, weight: d.weight ?? null } });
  };
  const bowl = { ...entry("e1", "Burrito bowl", 680), grams: 450 };

  it("to another Day writes both Day rows, keeping the amount, snapshot, water and weight", async () => {
    await h.call(h.A, "putDay", { input: { ...day("2026-11-02", [bowl, entry("e2", "Apple", 95, "snack")]), water: 3, weight: 171.4 } });
    await h.call(h.A, "putDay", { input: { ...day("2026-11-01", [entry("e3", "Toast", 120, "breakfast")]), water: 8 } });

    await move("2026-11-02", "e1", { date: "2026-11-01" });

    const [y, t] = await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-02" });
    expect(y).toMatchObject({ date: "2026-11-01", water: 8, entries: [{ id: "e3" }, { id: "e1", meal: "lunch", name: "Burrito bowl", grams: 450, nutrition: nutrition(680) }] });
    expect(t).toMatchObject({ date: "2026-11-02", water: 3, weight: 171.4, entries: [{ id: "e2" }] });
    expect(t.entries).toHaveLength(1);
  });

  it("to an unlogged Day creates that Day's row", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [bowl]) });
    await move("2026-11-02", "e1", { date: "2026-10-30" });
    expect(h.db.dump().map((r) => `${r.SK}:${(r.entries as unknown[]).length}`).sort()).toEqual(["DAY#2026-10-30:1", "DAY#2026-11-02:0"]);
  });

  it("to another Meal rewrites only that Day", async () => {
    await h.call(h.A, "putDay", { input: day("2026-11-02", [bowl]) });
    await move("2026-11-02", "e1", { meal: "dinner" });
    expect((await read("2026-11-02"))!.entries).toMatchObject([{ id: "e1", meal: "dinner", grams: 450, nutrition: nutrition(680) }]);
    expect(h.db.dump()).toHaveLength(1);
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
