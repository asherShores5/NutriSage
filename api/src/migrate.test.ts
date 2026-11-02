// Ticket 16: the one-time migration from the old us-east-1 table, run against a fixture export of
// the old rows into the in-memory table, then read back through the real API handler.
process.env.ALLOWED_USERNAMES = "asher,aubyn";
const { harness } = await import("./testing/harness");
const { migrate, formatReport } = await import("./migrate/migrate");
const { OLD_ROWS } = await import("./migrate/fixture");
import { beforeEach, describe, expect, it } from "vitest";

const h = harness();
beforeEach(() => h.reset());
const target = () => ({ db: h.db, table: process.env.TABLE_NAME! });

describe("migration dry run", () => {
  it("counts what it would write per kind and writes nothing", async () => {
    const r = await migrate(OLD_ROWS, target(), { apply: false });
    expect(r.counts).toEqual({
      Day: { create: 4, unchanged: 0, differs: 0 },
      Goals: { create: 2, unchanged: 0, differs: 0 },
      Food: { create: 3, unchanged: 0, differs: 0 },
      Favorite: { create: 2, unchanged: 0, differs: 0 },
    });
    expect(r.entries).toBe(5);
    expect(r.skipped).toEqual({ tommy: 2 });
    expect(await h.call({ userId: "s", username: "asher" }, "days", { from: "2026-01-01", to: "2026-12-31" })).toEqual([]);
  });
});

const asher = { userId: "sub-asher", username: "asher" };
const aubyn = { userId: "sub-aubyn", username: "aubyn" };
const all = { from: "2026-01-01", to: "2026-12-31" };
const zero = { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 0 };

describe("migration apply, read back through the API", () => {
  beforeEach(async () => {
    await migrate(OLD_ROWS, target(), { apply: true });
  });

  it("keeps each Entry's exact nutrition and Meal; a missing Meal becomes Snack; missing nutrients are 0", async () => {
    const [d] = (await h.call(asher, "days", { from: "2026-08-14", to: "2026-08-14" })) as any[];
    expect(d.entries.map((e: any) => [e.name, e.meal, e.nutrition])).toEqual([
      ["oatmeal with banana", "breakfast", { carbs: 54, protein: 8, fat: 5, fiber: 7, sodium: 10, iron: 2.1, calories: 290 }],
      ["string cheese", "snack", { carbs: 2, protein: 14, fat: 12, fiber: 0, sodium: 400, iron: 0, calories: 160 }],
      ["chicken burrito bowl", "snack", { ...zero, carbs: 70, protein: 45, fat: 24, calories: 680 }],
    ]);
    expect(d.entries.every((e: any) => !e.libraryId)).toBe(true);
    expect(d).toMatchObject({ water: 6, weight: 171.4 });
  });

  it("reads a '(×N)' suffix as N servings and strips it from the name", async () => {
    const [d] = (await h.call(asher, "days", { from: "2026-08-14", to: "2026-08-14" })) as any[];
    expect(d.entries[1]).toMatchObject({ name: "string cheese", amount: 2, unit: "serving" });
    expect(d.entries[0].amount ?? null).toBeNull();
  });

  it("treats weight 0 or missing as not logged, and water null as 0", async () => {
    const asherDays = (await h.call(asher, "days", all)) as any[];
    expect(asherDays.map((d) => [d.date, d.water, d.weight])).toEqual([
      ["2026-07-07", 0, null], ["2026-07-08", 0, null], ["2026-08-14", 6, 171.4],
    ]);
    const [p] = (await h.call(aubyn, "days", all)) as any[];
    expect([p.date, p.water, p.weight, p.entries[0].meal]).toEqual(["2026-07-09", 0, null, "lunch"]);
  });

  it("carries goals over, waterGoal becoming the water goal (8 cups when there was none)", async () => {
    expect(await h.call(asher, "goals")).toEqual({ carbs: 250, protein: 160, fat: 75, fiber: 35, sodium: 2300, iron: 8, calories: 2400, water: 10 });
    expect(await h.call(aubyn, "goals")).toEqual({ carbs: 180, protein: 110, fat: 60, fiber: 28, sodium: 2000, iron: 18, calories: 1800, water: 8 });
  });

  it("turns old Favorites and quick-add meals into serving-only Foods, one per name, and old Favorites into Favorites", async () => {
    const { foods } = await h.call(asher, "library");
    const byName = Object.fromEntries(foods.map((f: any) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual(["Costco hot dog", "greek yogurt", "protein shake"]);
    expect(byName["Costco hot dog"]).toMatchObject({
      units: [{ label: "serving", grams: 1 }],
      nutrition: { carbs: 46, protein: 24, fat: 32, fiber: 2, sodium: 1700, iron: 3.4, calories: 570 },
      createdBy: "asher",
    });
    const favs = (await h.call(asher, "favorites")) as any[];
    expect(favs.map((f) => foods.find((x: any) => x.id === f.libraryId).name).sort()).toEqual(["Costco hot dog", "protein shake"]);
    expect(await h.call(aubyn, "favorites")).toEqual([]);
  });

  it("skips Tommy", async () => {
    expect(h.db.dump().filter((r) => String(r.PK).includes("tommy"))).toEqual([]);
    expect(h.db.dump()).toHaveLength(4 + 2 + 3 + 2);
  });

  it("is a no-op the second time: every item unchanged, nothing created", async () => {
    const again = await migrate(OLD_ROWS, target(), { apply: true });
    expect(again.counts).toEqual({
      Day: { create: 0, unchanged: 4, differs: 0 },
      Goals: { create: 0, unchanged: 2, differs: 0 },
      Food: { create: 0, unchanged: 3, differs: 0 },
      Favorite: { create: 0, unchanged: 2, differs: 0 },
    });
  });

  it("never overwrites a Day changed in the new app since; it reports it instead", async () => {
    const [d] = (await h.call(asher, "days", { from: "2026-07-08", to: "2026-07-08" })) as any[];
    await h.call(asher, "putDay", { input: { date: d.date, entries: d.entries, water: 3, weight: null } });
    const again = await migrate(OLD_ROWS, target(), { apply: true });
    expect(again.counts.Day).toEqual({ create: 0, unchanged: 3, differs: 1 });
    expect(again.differing).toEqual(["MEMBER#asher/DAY#2026-07-08"]);
    const [after] = (await h.call(asher, "days", { from: "2026-07-08", to: "2026-07-08" })) as any[];
    expect(after.water).toBe(3);
    expect(formatReport(again)).toContain("MEMBER#asher/DAY#2026-07-08");
  });
});

describe("migration against a Library that already has Foods", () => {
  it("points an old Favorite at the existing Food of the same name instead of adding a twin", async () => {
    h.bedrock.reply('{"carbs":5,"protein":30,"fat":2,"fiber":1,"sodium":180,"iron":1,"calories":160,"servingGrams":350}');
    await h.call(asher, "estimate", { text: "Protein Shake" });
    const { foods: before } = await h.call(asher, "library");
    expect(before).toHaveLength(1);
    const r = await migrate(OLD_ROWS, target(), { apply: true });
    expect(r.counts.Food.create).toBe(2);
    expect(r.reused).toEqual([before[0].name]);
    const favs = (await h.call(asher, "favorites")) as any[];
    expect(favs.map((f) => f.libraryId)).toContain(before[0].id);
  });
});

describe("migration report", () => {
  it("prints the same counts for the dry run and the real run", async () => {
    const dry = formatReport(await migrate(OLD_ROWS, target(), { apply: false }));
    const real = formatReport(await migrate(OLD_ROWS, target(), { apply: true }));
    const table = (s: string) => s.split("\n").slice(2);
    expect(table(dry)).toEqual(table(real));
    expect(dry).toMatch(/^DRY RUN/);
    expect(dry).toContain("Day       4");
    expect(dry).toContain("Skipped old rows: tommy 2");
  });
});

describe("migration edge cases", () => {
  const extra = (data: unknown, sk = "2026-09-10") => ({ pk: { S: "asher" }, sk: { S: sk }, data: { S: JSON.stringify(data) } });

  it("orders Quick Add by when each old Favorite was last logged, never-logged ones below in the old order", async () => {
    const logged = extra({ entries: [{ food: "Costco hot dog (×2)", macros: { calories: 1140 }, meal: "lunch" }], updatedAt: "2026-09-10T20:00:00.000Z" });
    await migrate([...OLD_ROWS, logged], target(), { apply: true });
    const { foods } = await h.call(asher, "library");
    const { quickAdd } = await import("@nutrisage/shared");
    expect(quickAdd(await h.call(asher, "favorites"), foods).map((f: any) => f.name)).toEqual(["Costco hot dog", "protein shake"]);
  });

  it("leaves a name alone when its suffix isn't a valid amount", async () => {
    const odd = extra({ entries: [{ food: "water (×0)", macros: {}, meal: "snack" }, { food: "rice (×500)", macros: { carbs: 10 } }], updatedAt: "2026-09-10T20:00:00.000Z" });
    await migrate([odd], target(), { apply: true });
    const [d] = (await h.call(asher, "days", { from: "2026-09-10", to: "2026-09-10" })) as any[];
    expect(d.entries.map((e: any) => [e.name, e.amount ?? null])).toEqual([["water (×0)", null], ["rice (×500)", null]]);
  });

  it("keeps nutrition exactly, even past the API's limits, and lists those Entries in the report", async () => {
    const big = extra({ entries: [{ food: "party pizza", macros: { calories: 150000.5, sodium: 123456.7 }, meal: "dinner" }, { food: "tea", macros: { calories: 2.25 } }], updatedAt: "2026-09-10T20:00:00.000Z" });
    const dry = await migrate([big], target(), { apply: false });
    expect(dry.outliers).toEqual(["asher 2026-09-10 party pizza: sodium 123456.7, calories 150000.5"]);
    expect(formatReport(dry)).toContain("Over the API's limits (written as they are): asher 2026-09-10 party pizza: sodium 123456.7, calories 150000.5");
    await migrate([big], target(), { apply: true });
    const [d] = (await h.call(asher, "days", { from: "2026-09-10", to: "2026-09-10" })) as any[];
    expect(d.entries[0].nutrition).toMatchObject({ calories: 150000.5, sodium: 123456.7 });
    expect(d.entries[1].nutrition.calories).toBe(2.25);
  });

  it("skips rows it can't read, and counts them", async () => {
    const r = await migrate([{ pk: { S: "asher" }, sk: { S: "2026-09-11" }, data: { S: "{not json" } }], target(), { apply: false });
    expect(r.skipped).toEqual({ asher: 1 });
    expect(r.counts.Day.create).toBe(0);
  });
});

describe("migration script options", () => {
  it("is a dry run unless --apply is given, with the stack and old table defaults", async () => {
    const { parseArgs } = await import("./migrate/cli");
    expect(parseArgs([])).toEqual({ apply: false, stack: "NutriSage", region: "us-west-1", oldTable: "nutrisageai-data", oldRegion: "us-east-1" });
    expect(parseArgs(["--apply"]).apply).toBe(true);
    expect(parseArgs(["--dry-run", "--stack", "X"])).toMatchObject({ apply: false, stack: "X" });
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow();
    expect(() => parseArgs(["--aply"])).toThrow(/unknown option/);
  });
});
