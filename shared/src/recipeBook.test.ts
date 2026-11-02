// The Recipe Book (ticket 19; spec: Domain model > Recipe, Out of scope > nesting deeper than one
// level): a saved Recipe as an ingredient of another, one level deep; Recipes in search and Quick Add.
import { describe, expect, it } from "vitest";
import type { Food } from "./food";
import { emptyNutrition, type Nutrition } from "./nutrients";
import { checkRecipe, ingredientFromFood, logRecipe, type Recipe, type RecipeIngredient } from "./recipe";
import { QUICK_ADD_PORTION, ingredientUnits, rescaleIngredient, ingredientFromRecipe, isRecipe, logLibraryItem, nestingError, recipePortion, recipeUnits } from "./recipeBook";

const per = (n: Partial<Nutrition>): Nutrition => ({ ...emptyNutrition(), ...n });
const food = (id: string, name: string, nutrition: Partial<Nutrition>, units: [string, number][]): Food => ({
  id, name, nutrition: per(nutrition), units: units.map(([label, grams]) => ({ label, grams })), createdBy: "asher", updatedAt: 1,
});
// 100 g of beef is 250 cal; a 400 g can of beans is 360 cal; a tortilla is 150 cal.
const BEEF = food("beef", "Ground beef", { protein: 0.2, calories: 2.5 }, [["serving", 113], ["g", 1]]);
const BEANS = food("beans", "Kidney beans", { carbs: 0.15, calories: 0.9 }, [["serving", 130], ["g", 1], ["can", 400]]);
const TORTILLA = food("tort", "Tortilla", { calories: 2.5 }, [["serving", 60], ["g", 1]]);

const ing = (f: Food, amount: number, unit: string): RecipeIngredient => {
  const r = ingredientFromFood(f, { amount, unit });
  if (!r.ok) throw new Error(r.error);
  return r.ingredient;
};

// 1250 + 360 = 1610 cal, cooked down to 1200 g.
const CHILI: Recipe = {
  id: "chili", name: "Chili", ingredients: [ing(BEEF, 500, "g"), ing(BEANS, 1, "can")], preparedGrams: 1200, createdBy: "asher", updatedAt: 1,
};
const nested = (r: Recipe, amount: number, unit: string): RecipeIngredient => {
  const x = ingredientFromRecipe(r, { amount, unit });
  if (!x.ok) throw new Error(x.error);
  return x.ingredient;
};
const BURRITO: Recipe = {
  id: "burrito", name: "Burrito", ingredients: [ing(TORTILLA, 1, "serving"), nested(CHILI, 300, "g")], preparedGrams: null, createdBy: "aubyn", updatedAt: 2,
};

// Not weighed, and a spice of unknown weight: no Prepared weight at all, not even a Yield-ratio estimate.
const SPICED: Recipe = {
  ...CHILI, id: "spiced", name: "Spiced beans", preparedGrams: null,
  ingredients: [ing(BEANS, 1, "can"), { libraryId: null, name: "Spice mix", amount: 1, unit: "serving", nutrition: per({ calories: 10 }) }],
};

describe("a saved Recipe as an ingredient", () => {
  it("is a portion of it (g or a fraction of the batch) pointing at the Recipe, with its own breakdown", () => {
    const x = nested(CHILI, 300, "g");
    expect(x).toMatchObject({ libraryId: "chili", name: "Chili", amount: 300, unit: "g", grams: 300 });
    expect(x.nutrition.calories).toBe(402.5); // 1610 x 300 / 1200
    expect(x.ingredients?.map((i) => [i.name, i.grams])).toEqual([["Ground beef", 125], ["Kidney beans", 100]]);
    expect(x.yieldRatio).toBeUndefined(); // already prepared: it counts at its own weight
    expect(nested(CHILI, 0.5, "batch")).toMatchObject({ amount: 0.5, unit: "batch", grams: 600, nutrition: { calories: 805 } });
  });

  it("adds up in the outer Recipe like any ingredient, and its Entry lists it as one line", () => {
    const r = logRecipe(BURRITO, { amount: 1, unit: "batch" }, "lunch");
    if (!r.ok) throw new Error(r.error);
    expect(r.entry.nutrition.calories).toBe(552.5); // 150 + 402.5
    expect(r.entry.ingredients?.map((i) => i.name)).toEqual(["Tortilla", "Chili"]);
  });

  it("can't be a Recipe that already contains a Recipe (one level deep)", () => {
    expect(ingredientFromRecipe(BURRITO, { amount: 1, unit: "batch" })).toEqual({
      ok: false, error: "Burrito already has a Recipe in it, and Recipes nest only one level deep",
    });
  });

  it("logs in g only when the Recipe has a Prepared weight (weighed or estimated)", () => {
    expect(ingredientFromRecipe({ ...CHILI, preparedGrams: null }, { amount: 300, unit: "g" })).toMatchObject({ ok: true, ingredient: { grams: 300 } });
    expect(ingredientFromRecipe(SPICED, { amount: 300, unit: "g" })).toMatchObject({ ok: false, error: expect.stringContaining("Prepared weight") });
  });
});

describe("checkRecipe and nesting", () => {
  it("keeps one level of nesting, breakdown included", () => {
    const r = checkRecipe(BURRITO);
    expect(r.ok && r.recipe.ingredients[1].ingredients).toEqual(BURRITO.ingredients[1].ingredients);
  });

  it("rejects a Recipe inside a Recipe inside a Recipe", () => {
    const deep = { ...nested(CHILI, 300, "g"), ingredients: [{ ...ing(TORTILLA, 1, "serving"), ingredients: [ing(BEEF, 10, "g")] }] };
    expect(checkRecipe({ name: "Bowl", ingredients: [deep] })).toEqual({ ok: false, error: "Chili: Recipes nest only one level deep" });
  });

  it("checks the nested breakdown like any ingredient", () => {
    const bad = { ...nested(CHILI, 300, "g"), ingredients: [{ ...ing(BEEF, 10, "g"), nutrition: per({ fat: -1 }) }] };
    expect(checkRecipe({ name: "Bowl", ingredients: [bad] })).toMatchObject({ ok: false, error: expect.stringContaining("fat") });
  });
});

describe("nestingError (against the Recipe Book, the API runs it too)", () => {
  const book = [CHILI, BURRITO];
  it("allows a Recipe of Foods and saved Recipes of Foods", () => {
    expect(nestingError({ id: "bowl", name: "Bowl", ingredients: [nested(CHILI, 1, "batch")] }, book)).toBeNull();
    expect(nestingError(CHILI, book)).toBeNull();
  });

  it("refuses an ingredient that is a saved Recipe with a Recipe in it, even without its breakdown", () => {
    const hidden = { ...ing(TORTILLA, 1, "serving"), libraryId: "burrito", name: "Burrito" };
    expect(nestingError({ id: "plate", name: "Plate", ingredients: [hidden] }, book)).toBe("Burrito already has a Recipe in it, and Recipes nest only one level deep");
  });

  it("refuses a Recipe inside itself", () => {
    expect(nestingError({ ...CHILI, ingredients: [...CHILI.ingredients, nested(CHILI, 1, "batch")] }, book)).toBe("A Recipe can't be an ingredient of itself");
  });

  it("refuses giving a Recipe a Recipe ingredient while another Recipe uses it", () => {
    const stew: Recipe = { ...CHILI, id: "stew", name: "Stew", ingredients: [ing(BEEF, 100, "g")] };
    const edited = { ...CHILI, ingredients: [...CHILI.ingredients, nested(stew, 1, "batch")] };
    expect(nestingError(edited, [...book, stew])).toBe("Chili is an ingredient of Burrito, so it can't have a Recipe in it (Recipes nest only one level deep)");
  });
});

describe("Recipes in the add box and Quick Add", () => {
  it("tells a Recipe from a Food", () => {
    expect(isRecipe(CHILI)).toBe(true);
    expect(isRecipe(BEEF)).toBe(false);
  });

  it("logs in a fraction of the batch, or g when the Prepared weight is known", () => {
    expect(recipeUnits(CHILI)).toEqual(["batch", "g"]);
    expect(recipeUnits(BURRITO)).toEqual(["batch", "g"]); // estimated: 60 g tortilla + 300 g Chili
    expect(recipeUnits(SPICED)).toEqual(["batch"]);
  });

  it("Quick Add (and any unit a Recipe hasn't got) logs 1/4 of the batch", () => {
    expect(QUICK_ADD_PORTION).toEqual({ amount: 0.25, unit: "batch" });
    expect(recipePortion(CHILI, { amount: 1, unit: "serving" })).toEqual(QUICK_ADD_PORTION);
    expect(recipePortion(SPICED, { amount: 200, unit: "g" })).toEqual(QUICK_ADD_PORTION);
    expect(recipePortion(CHILI, { amount: 200, unit: "g" })).toEqual({ amount: 200, unit: "g" });
  });

  it("logLibraryItem logs a Food by its units and a Recipe by its portion", () => {
    expect(logLibraryItem(BEANS, { amount: 1, unit: "can" }, "dinner")).toMatchObject({ ok: true, entry: { name: "Kidney beans", nutrition: { calories: 360 } } });
    const r = logLibraryItem(CHILI, { amount: 1, unit: "serving" }, "dinner");
    expect(r).toMatchObject({ ok: true, entry: { name: "Chili", amount: 0.25, unit: "batch", grams: 300, libraryId: "chili" } });
    expect(r.ok && r.entry.nutrition.calories).toBe(402.5);
  });
});

describe("editing a saved Recipe's ingredient amounts (its snapshot, not the live Food)", () => {
  const beans = ing(BEANS, 1, "can");
  it("offers the ingredient's own unit, plus g when its grams are known", () => {
    expect(ingredientUnits(beans)).toEqual(["can", "g"]);
    expect(ingredientUnits(ing(BEEF, 500, "g"))).toEqual(["g"]);
    expect(ingredientUnits({ ...beans, grams: null })).toEqual(["can"]);
  });

  it("rescales nutrition, grams and a nested breakdown; the same amount keeps it as is", () => {
    expect(rescaleIngredient(beans, { amount: 1, unit: "can" })).toEqual({ ok: true, ingredient: beans });
    expect(rescaleIngredient(beans, { amount: 2, unit: "can" })).toMatchObject({ ok: true, ingredient: { amount: 2, unit: "can", grams: 800, nutrition: { calories: 720 } } });
    expect(rescaleIngredient(beans, { amount: 200, unit: "g" })).toMatchObject({ ok: true, ingredient: { amount: 200, unit: "g", grams: 200, nutrition: { calories: 180 } } });
    const chili = nested(CHILI, 300, "g");
    const r = rescaleIngredient(chili, { amount: 600, unit: "g" });
    expect(r.ok && r.ingredient.ingredients?.map((i) => i.grams)).toEqual([250, 200]);
    expect(r.ok && r.ingredient.nutrition.calories).toBe(805);
  });

  it("refuses a bad amount or a unit with no known weight", () => {
    expect(rescaleIngredient(beans, { amount: 0, unit: "can" })).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(rescaleIngredient({ ...beans, grams: null }, { amount: 10, unit: "g" })).toMatchObject({ ok: false });
  });
});
