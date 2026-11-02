import { describe, expect, it } from "vitest";
import { findFoodByName, foodFromServing, foodNameKey, foodUnits, logFood, type Food } from "./food";

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.8, calories: 180 };
/** Numbers rounded to 6 places, so float noise doesn't fail an exact comparison. */
const tidy = (n: Record<string, number>) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));

const saved = (f: ReturnType<typeof foodFromServing>, id = "f1"): Food => ({ id, createdBy: "asher", updatedAt: 1, ...f });

describe("foodFromServing (a Food per gram from one estimated serving)", () => {
  it("stores nutrition per gram, with serving and g units", () => {
    const f = foodFromServing({ name: "2 eggs scrambled", nutrition: EGGS, servingGrams: 120 });
    expect(tidy(f.nutrition)).toEqual({ carbs: 0.01, protein: 0.105, fat: 0.084167, fiber: 0, sodium: 2.85, iron: 0.015, calories: 1.5 });
    expect(f.units).toEqual([{ label: "serving", grams: 120 }, { label: "g", grams: 1 }]);
    expect(f.name).toBe("2 eggs scrambled");
  });

  it("adds suggested units after serving and g, skipping duplicates and junk", () => {
    const f = foodFromServing({
      name: "Eggs", nutrition: EGGS, servingGrams: 120,
      units: [{ label: "Egg", grams: 60 }, { label: "g", grams: 5 }, { label: "egg", grams: 61 }, { label: "", grams: 3 }, { label: "cup", grams: -1 }, { label: "slice", grams: NaN }],
    });
    expect(f.units).toEqual([{ label: "serving", grams: 120 }, { label: "g", grams: 1 }, { label: "egg", grams: 60 }]);
  });

  it("keeps a Yield ratio when there is one", () => {
    expect(foodFromServing({ name: "Rice", nutrition: EGGS, servingGrams: 50, yieldRatio: 2.5 }).yieldRatio).toBe(2.5);
    expect(foodFromServing({ name: "Rice", nutrition: EGGS, servingGrams: 50 }).yieldRatio ?? null).toBeNull();
  });

  it("with no known serving weight, has only a serving unit (no g) and that serving's nutrition", () => {
    const f = foodFromServing({ name: "Mystery stew", nutrition: EGGS, servingGrams: null });
    expect(foodUnits(f).map((u) => u.label)).toEqual(["serving"]);
    expect(logFood(saved(f), { amount: 2, unit: "serving" }, "lunch")).toMatchObject({ ok: true, entry: { nutrition: { calories: 360 } } });
    expect(logFood(saved(f), { amount: 50, unit: "g" }, "lunch")).toEqual({ ok: false, error: "No gram weight is known for Mystery stew, so it can't be logged in g" });
  });

  it("turns junk nutrition into 0, never NaN", () => {
    const f = foodFromServing({ name: "x", nutrition: { ...EGGS, calories: NaN }, servingGrams: 100 });
    expect(f.nutrition.calories).toBe(0);
  });
});

describe("logFood (an Entry for an amount of a Library Food)", () => {
  const eggs = saved(foodFromServing({ name: "Eggs", nutrition: EGGS, servingGrams: 120, units: [{ label: "egg", grams: 60 }] }), "eggs-1");

  it("logs amount x unit grams x nutrition per gram, with grams and a reference to the Food", () => {
    const r = logFood(eggs, { amount: 3, unit: "egg" }, "breakfast");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ ...r.entry, nutrition: tidy(r.entry.nutrition) }).toEqual({
      meal: "breakfast", name: "Eggs", amount: 3, unit: "egg", grams: 180, libraryId: "eggs-1",
      nutrition: { carbs: 1.8, protein: 18.9, fat: 15.15, fiber: 0, sodium: 513, iron: 2.7, calories: 270 },
    });
  });

  it("logs in grams and in servings", () => {
    expect(logFood(eggs, { amount: 30, unit: "g" }, "snack")).toMatchObject({ ok: true, entry: { grams: 30, nutrition: { calories: 45 } } });
    expect(logFood(eggs, { amount: 0.5, unit: "serving" }, "snack")).toMatchObject({ ok: true, entry: { grams: 60, nutrition: { calories: 90 } } });
  });

  it("refuses a unit the Food doesn't have, and amounts out of range", () => {
    expect(logFood(eggs, { amount: 1, unit: "cup" }, "lunch")).toEqual({ ok: false, error: "Eggs has no unit called cup" });
    expect(logFood(eggs, { amount: 0, unit: "egg" }, "lunch")).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(logFood(eggs, { amount: 101, unit: "egg" }, "lunch")).toEqual({ ok: false, error: "Amount must be at most 100" });
    expect(logFood(eggs, { amount: 5001, unit: "g" }, "lunch")).toEqual({ ok: false, error: "Amount must be at most 5000 g" });
  });

  it("offers the Food's units with their gram weights for the unit picker", () => {
    expect(foodUnits(eggs)).toEqual([{ label: "serving", grams: 120 }, { label: "g", grams: 1 }, { label: "egg", grams: 60 }]);
  });
});

describe("Food names (deduplicated case-insensitively)", () => {
  const foods = [saved(foodFromServing({ name: "Greek Yogurt", nutrition: EGGS, servingGrams: 170 }), "y")];

  it("matches ignoring case and extra spaces", () => {
    expect(foodNameKey("  Greek   YOGURT ")).toBe("greek yogurt");
    expect(findFoodByName(foods, "greek yogurt")?.id).toBe("y");
    expect(findFoodByName(foods, " GREEK  yogurt")?.id).toBe("y");
  });

  it("doesn't match a different name", () => {
    expect(findFoodByName(foods, "greek yogurt with honey")).toBeUndefined();
    expect(findFoodByName(foods, "")).toBeUndefined();
  });
});
