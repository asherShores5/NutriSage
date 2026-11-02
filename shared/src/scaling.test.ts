import { describe, expect, it } from "vitest";
import type { Entry } from "./day";
import { entryAmount, entryAmountLabel, entryUnits, rescaleEntry, scaleSnapshot, servingUnits } from "./scaling";

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 180 };
const one = { amount: 1, unit: "serving" };
/** Nutrition rounded to 6 places, so float noise (1.2 * 1.5) doesn't fail an exact comparison. */
const tidy = (r: any) => (r.ok ? { ...r, nutrition: Object.fromEntries(Object.entries(r.nutrition).map(([k, v]) => [k, Math.round((v as number) * 1e6) / 1e6])) } : r);

describe("scaleSnapshot (nutrition for a different amount or unit)", () => {
  const units = servingUnits(120);

  it("multiplies by the amount within the same unit", () => {
    const r = scaleSnapshot({ nutrition: EGGS, grams: 120 }, one, { amount: 1.5, unit: "serving" }, units);
    expect(tidy(r)).toEqual({ ok: true, nutrition: { carbs: 1.8, protein: 18.9, fat: 15.15, fiber: 0, sodium: 513, iron: 2.55, calories: 270 }, grams: 180 });
  });

  it("converts through gram weights between units", () => {
    const r = scaleSnapshot({ nutrition: EGGS, grams: 120 }, one, { amount: 60, unit: "g" }, units);
    expect(r).toMatchObject({ ok: true, grams: 60 });
    expect((r as { nutrition: typeof EGGS }).nutrition.calories).toBeCloseTo(90);
  });

  it("scales without grams when none are known, as long as the unit stays the same", () => {
    expect(scaleSnapshot({ nutrition: EGGS, grams: null }, one, { amount: 2, unit: "serving" }, servingUnits(null)))
      .toMatchObject({ ok: true, grams: null, nutrition: { calories: 360 } });
  });

  it("refuses a unit change when a gram weight is missing", () => {
    expect(scaleSnapshot({ nutrition: EGGS, grams: null }, one, { amount: 50, unit: "g" }, servingUnits(null)))
      .toEqual({ ok: false, error: "No gram weight is known for a serving, so it can't be logged in g" });
  });

  it("refuses an amount out of range for the unit", () => {
    expect(scaleSnapshot({ nutrition: EGGS, grams: 120 }, one, { amount: 101, unit: "serving" }, units))
      .toEqual({ ok: false, error: "Amount must be at most 100" });
    expect(scaleSnapshot({ nutrition: EGGS, grams: 120 }, one, { amount: 0, unit: "serving" }, units))
      .toEqual({ ok: false, error: "Amount must be more than 0" });
  });
});

describe("servingUnits (units for one estimated serving)", () => {
  it("offers serving, plus g when the serving's gram weight is known", () => {
    expect(servingUnits(122)).toEqual([{ label: "serving", grams: 122 }, { label: "g", grams: 1 }]);
    expect(servingUnits(null)).toEqual([{ label: "serving", grams: null }]);
  });
});

describe("an Entry's amount and units", () => {
  const entry: Entry = { id: "e1", meal: "breakfast", name: "Eggs", nutrition: EGGS };

  it("a migrated Entry with no unit counts as 1 serving of its snapshot", () => {
    expect(entryAmount(entry)).toEqual({ amount: 1, unit: "serving" });
    expect(entryUnits(entry)).toEqual([{ label: "serving", grams: null }]);
  });

  it("an Entry with grams can switch between its unit and g", () => {
    const e = { ...entry, amount: 1.5, unit: "serving", grams: 180 };
    expect(entryAmount(e)).toEqual({ amount: 1.5, unit: "serving" });
    expect(entryUnits(e)).toEqual([{ label: "serving", grams: 120 }, { label: "g", grams: 1 }]);
    expect(entryUnits({ ...entry, amount: 200, unit: "g", grams: 200 })).toEqual([{ label: "g", grams: 1 }]);
  });

  it("rescaleEntry changes amount, unit, grams and the snapshot, and nothing else", () => {
    const e = { ...entry, amount: 1.5, unit: "serving", grams: 180, nutrition: { ...EGGS, calories: 270 } };
    const r = rescaleEntry(e, { amount: 1 / 3, unit: "serving" }, entryUnits(e));
    expect(r.ok).toBe(true);
    const out = (r as { entry: Entry }).entry;
    expect(out).toMatchObject({ id: "e1", meal: "breakfast", name: "Eggs", amount: 1 / 3, unit: "serving" });
    expect(out.nutrition.calories).toBeCloseTo(60);
    expect(out.grams).toBeCloseTo(40);
  });

  it("rescaling a migrated Entry treats its snapshot as 1 serving", () => {
    const r = rescaleEntry(entry, { amount: 0.5, unit: "serving" }, entryUnits(entry));
    expect(r).toMatchObject({ ok: true, entry: { amount: 0.5, unit: "serving", nutrition: { calories: 90 } } });
    expect((r as { entry: object }).entry).not.toHaveProperty("grams");
  });
});

describe("rescaling a Recipe Entry", () => {
  const n = (calories: number) => ({ carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories });
  const chili: Entry = {
    id: "r", meal: "dinner", name: "Chili", amount: 300, unit: "g", grams: 300, nutrition: n(400),
    ingredients: [{ name: "Beef", grams: 100, amount: 100, unit: "g", nutrition: n(250) }, { name: "Beans", grams: 200, amount: 0.5, unit: "can", nutrition: n(150) }],
  };

  it("scales the ingredient breakdown with the portion, so it still adds up", () => {
    const r = rescaleEntry(chili, { amount: 450, unit: "g" }, entryUnits(chili));
    if (!r.ok) throw new Error(r.error);
    expect(r.entry.nutrition.calories).toBe(600);
    expect(r.entry.ingredients).toEqual([
      { name: "Beef", grams: 150, amount: 150, unit: "g", nutrition: n(375) },
      { name: "Beans", grams: 300, amount: 0.75, unit: "can", nutrition: n(225) },
    ]);
  });

  it("a fraction-of-batch Entry with no grams rescales by fraction", () => {
    const e: Entry = { ...chili, amount: 0.25, unit: "batch", grams: undefined };
    const r = rescaleEntry(e, { amount: 0.5, unit: "batch" }, entryUnits(e));
    expect(r.ok && r.entry.ingredients?.map((i) => i.nutrition.calories)).toEqual([500, 300]);
  });
});

describe("entryAmountLabel (what an Entry row says it holds)", () => {
  it("is the amount and unit, then the grams when known", () => {
    expect(entryAmountLabel({ amount: 1.5, unit: "serving", grams: 183.2 })).toBe("1 1/2 serving · 183 g");
    expect(entryAmountLabel({ amount: 2, unit: "cup", grams: null })).toBe("2 cup");
    expect(entryAmountLabel({ amount: 0.25, unit: "batch", grams: 300 })).toBe("1/4 batch · 300 g");
  });

  it("in g it's the grams once; a migrated Entry is 1 serving", () => {
    expect(entryAmountLabel({ amount: 150, unit: "g", grams: 150 })).toBe("150 g");
    expect(entryAmountLabel({})).toBe("1 serving");
  });
});
