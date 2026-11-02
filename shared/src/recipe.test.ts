// Recipes (spec: Domain model > Recipe; Testing > Recipe totals, Prepared weight, per-portion nutrition).
import { describe, expect, it } from "vitest";
import type { Food } from "./food";
import { emptyNutrition, type Nutrition } from "./nutrients";
import { BATCH, checkRecipe, ingredientFromFood, logRecipe, preparedWeight, rawWeight, recipeTotals, type NewRecipe, type RecipeIngredient } from "./recipe";

const per = (n: Partial<Nutrition>): Nutrition => ({ ...emptyNutrition(), ...n });
const food = (id: string, name: string, nutrition: Partial<Nutrition>, units: [string, number][], yieldRatio?: number): Food => ({
  id, name, nutrition: per(nutrition), units: units.map(([label, grams]) => ({ label, grams })), createdBy: "asher", updatedAt: 1, ...(yieldRatio ? { yieldRatio } : {}),
});

// 100 g of beef is 250 cal, 20 g protein, 15 g fat.
const BEEF = food("beef", "Ground beef", { protein: 0.2, fat: 0.15, calories: 2.5 }, [["serving", 113], ["g", 1]], 0.75);
// A 400 g can: 360 cal, 60 g carbs.
const BEANS = food("beans", "Kidney beans", { carbs: 0.15, calories: 0.9 }, [["serving", 130], ["g", 1], ["can", 400]]);
// A 240 g cup: 48 cal.
const TOMATO = food("tom", "Crushed tomatoes", { carbs: 0.04, calories: 0.2 }, [["serving", 120], ["g", 1], ["cup", 240]]);
// One serving, weight unknown: 100 cal.
const MYSTERY = food("mys", "Chili spice mix", { calories: 100 }, [["serving", 1]]);

const ing = (f: Food, amount: number, unit: string): RecipeIngredient => {
  const r = ingredientFromFood(f, { amount, unit });
  if (!r.ok) throw new Error(r.error);
  return r.ingredient;
};

const chili = (preparedGrams: number | null = 1200): NewRecipe => ({
  name: "Chili",
  ingredients: [ing(BEEF, 500, "g"), ing(BEANS, 1, "can"), ing(TOMATO, 2, "cup")],
  preparedGrams,
});
/** Not weighed, and the spice mix has no gram weight: no Prepared weight at all. */
const unweighable = (): NewRecipe => ({ ...chili(null), ingredients: [...chili().ingredients, ing(MYSTERY, 1, "serving")] });

describe("ingredients", () => {
  it("snapshot the amount, grams and nutrition of what went in, and point at the Food", () => {
    expect(ing(BEANS, 1, "can")).toEqual({
      libraryId: "beans", name: "Kidney beans", amount: 1, unit: "can", grams: 400, nutrition: per({ carbs: 60, calories: 360 }),
    });
  });

  it("keep the Food's Yield ratio for Prepared weight estimates", () => {
    expect(ing(BEEF, 500, "g").yieldRatio).toBe(0.75);
  });

  it("refuse a unit the Food doesn't have, or a bad amount", () => {
    expect(ingredientFromFood(MYSTERY, { amount: 100, unit: "g" })).toMatchObject({ ok: false });
    expect(ingredientFromFood(BEEF, { amount: 0, unit: "g" })).toEqual({ ok: false, error: "Amount must be more than 0" });
  });
});

describe("Recipe totals and raw weight", () => {
  it("total nutrition is the sum of the ingredients", () => {
    const t = recipeTotals(chili());
    expect(t.calories).toBeCloseTo(1706); // 1250 + 360 + 96
    expect(t.protein).toBeCloseTo(100);
    expect(t.carbs).toBeCloseTo(79.2); // 60 + 19.2
  });

  it("raw weight is the sum of ingredient grams", () => {
    expect(rawWeight(chili())).toBe(1380); // 500 + 400 + 480
  });

  it("raw weight is unknown when an ingredient's grams are", () => {
    const r = { ...chili(), ingredients: [...chili().ingredients, ing(MYSTERY, 1, "serving")] };
    expect(rawWeight(r)).toBeNull();
    expect(recipeTotals(r).calories).toBeCloseTo(1806);
  });

  it("an empty Recipe totals 0", () => {
    expect(recipeTotals({ ingredients: [] })).toEqual(emptyNutrition());
  });
});

describe("Prepared weight", () => {
  it("is the weighed value when set", () => {
    expect(preparedWeight(chili(1200))).toEqual({ grams: 1200, source: "weighed" });
  });

  it("the weighed value wins over the Yield-ratio estimate", () => {
    expect(preparedWeight(chili(900))).toEqual({ grams: 900, source: "weighed" });
  });

  it("is estimated from Yield ratios when not weighed: each ingredient's grams x its ratio, 1 when unknown", () => {
    // beef 500 g x 0.75 + beans 400 g x 1 + tomatoes 480 g x 1
    expect(preparedWeight(chili(null))).toEqual({ grams: 1255, source: "estimated" });
  });

  it("a ratio above 1 grows the estimate (dry rice soaks up water)", () => {
    const RICE = food("rice", "Dry rice", { calories: 3.6 }, [["serving", 45], ["g", 1]], 2.5);
    expect(preparedWeight({ ingredients: [ing(RICE, 200, "g"), ing(BEANS, 1, "can")], preparedGrams: null })).toEqual({ grams: 900, source: "estimated" });
  });

  it("is unknown when not weighed and an ingredient's grams are unknown", () => {
    expect(preparedWeight(unweighable())).toBeNull();
    expect(preparedWeight({ ingredients: [], preparedGrams: null })).toBeNull();
  });
});

describe("logging a portion", () => {
  it("by grams: total nutrition x grams / Prepared weight, as one Entry named after the Recipe", () => {
    const r = logRecipe({ ...chili(), id: "r1" }, { amount: 350, unit: "g" }, "dinner");
    if (!r.ok) throw new Error(r.error);
    expect(r.entry).toMatchObject({ meal: "dinner", name: "Chili", amount: 350, unit: "g", grams: 350, libraryId: "r1" });
    expect(r.entry.nutrition.calories).toBeCloseTo(497.58, 2); // 1706 * 350 / 1200
    expect(r.entry.nutrition.protein).toBeCloseTo(29.17, 2);
  });

  it("by grams snapshots the ingredient breakdown for that portion", () => {
    const r = logRecipe(chili(), { amount: 300, unit: "g" }, "dinner"); // a quarter of 1200 g
    if (!r.ok) throw new Error(r.error);
    expect(r.entry.ingredients?.map((i) => [i.name, i.grams, Math.round(i.nutrition.calories)])).toEqual([
      ["Ground beef", 125, 313], ["Kidney beans", 100, 90], ["Crushed tomatoes", 120, 24],
    ]);
    expect(r.entry.ingredients?.[2]).toMatchObject({ amount: 0.5, unit: "cup" });
  });

  it("by grams works on an estimated Prepared weight", () => {
    const r = logRecipe(chili(null), { amount: 251, unit: "g" }, "dinner"); // a fifth of the 1255 g estimate
    if (!r.ok) throw new Error(r.error);
    expect(r.entry).toMatchObject({ amount: 251, unit: "g", grams: 251 });
    expect(r.entry.nutrition.calories).toBeCloseTo(341.2); // 1706 / 5
  });

  it("by grams needs a Prepared weight, weighed or estimated", () => {
    expect(logRecipe(unweighable(), { amount: 350, unit: "g" }, "dinner")).toEqual({
      ok: false, error: "Enter the Prepared weight (weigh the finished batch) to log Chili in g",
    });
  });

  it("by fraction of the batch: total nutrition x fraction, with grams when the Prepared weight is known", () => {
    const r = logRecipe(chili(), { amount: 0.25, unit: BATCH }, "lunch");
    if (!r.ok) throw new Error(r.error);
    expect(r.entry).toMatchObject({ amount: 0.25, unit: "batch", grams: 300 });
    expect(r.entry.nutrition.calories).toBeCloseTo(426.5);
  });

  it("by fraction works without a Prepared weight (no grams then)", () => {
    const r = logRecipe(unweighable(), { amount: 0.5, unit: BATCH }, "lunch");
    if (!r.ok) throw new Error(r.error);
    expect(r.entry.grams).toBeUndefined();
    expect(r.entry.nutrition.calories).toBeCloseTo(903); // (1706 + 100) / 2
    expect(r.entry.ingredients).toHaveLength(4);
  });

  it("an unsaved Recipe's Entry points at nothing", () => {
    const r = logRecipe(chili(), { amount: 1, unit: BATCH }, "lunch");
    expect(r.ok && r.entry.libraryId).toBeFalsy();
  });

  it("refuses bad amounts and other units", () => {
    expect(logRecipe(chili(), { amount: 0, unit: "g" }, "lunch")).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(logRecipe(chili(), { amount: 6000, unit: "g" }, "lunch")).toEqual({ ok: false, error: "Amount must be at most 5000 g" });
    expect(logRecipe(chili(), { amount: 1, unit: "serving" }, "lunch")).toMatchObject({ ok: false });
  });

  it("needs ingredients", () => {
    expect(logRecipe({ name: "Air", ingredients: [], preparedGrams: null }, { amount: 1, unit: BATCH }, "lunch")).toEqual({
      ok: false, error: "Add at least one ingredient",
    });
  });
});

describe("checkRecipe (the API checks the same)", () => {
  it("tidies the name and keeps a good Recipe", () => {
    const r = checkRecipe({ ...chili(), name: "  Big   chili " });
    expect(r).toMatchObject({ ok: true, recipe: { name: "Big chili", preparedGrams: 1200 } });
  });

  it.each([
    [{ name: " " }, "Give the Recipe a name"],
    [{ ingredients: [] }, "Add at least one ingredient"],
    [{ preparedGrams: 0 }, "Prepared weight must be more than 0 and at most 50000 g"],
    [{ preparedGrams: Number.NaN }, "Prepared weight must be more than 0 and at most 50000 g"],
  ])("refuses %o", (change, error) => {
    expect(checkRecipe({ ...chili(), ...change } as NewRecipe)).toEqual({ ok: false, error });
  });

  it("refuses junk ingredients", () => {
    const bad = { ...ing(BEEF, 1, "g"), nutrition: { ...per({}), calories: -1 } };
    expect(checkRecipe({ ...chili(), ingredients: [bad] })).toMatchObject({ ok: false });
    expect(checkRecipe({ ...chili(), ingredients: [{ ...bad, nutrition: per({}), name: "" }] })).toMatchObject({ ok: false });
    expect(checkRecipe({ ...chili(), ingredients: Array(51).fill(ing(BEEF, 1, "g")) })).toEqual({ ok: false, error: "At most 50 ingredients" });
  });
});
