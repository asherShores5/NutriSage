// Recipes (spec: Domain model > Recipe; GLOSSARY: Recipe, Prepared weight, Yield ratio, Recipe Book).
// A Recipe is a combination of ingredients, each an amount of a Library Food snapshotted when it was
// added (name, amount, unit, grams, nutrition), plus an optional weighed Prepared weight. A portion
// is logged in g (needs the Prepared weight) or as a fraction of the batch, as one Entry that also
// snapshots its ingredient breakdown for that portion.
//
// When the batch wasn't weighed, the Prepared weight is estimated from each ingredient's Yield ratio
// (ticket 18), so logging in g works on the estimate too.
//
// Room left for later tickets:
// - 19: an ingredient may be a portion of a saved Recipe (its `libraryId` a RECIPE id), one level deep;
//   its snapshot is just another ingredient here, so totals and portions need no change.
import { amountMax, isAmount } from "./amount";
import type { Entry, EntryIngredient, Meal } from "./day";
import { logFood, type Food } from "./food";
import { NUTRIENT_MAX, YIELD_MAX } from "./foodEdit";
import { NUTRIENT_KEYS, num, sumMacros, type Nutrition } from "./nutrients";
import { GRAMS, type Amount } from "./scaling";

/** The unit for a fraction of the whole batch: 1/4 batch is a quarter of the Recipe. */
export const BATCH = "batch";

/** One ingredient: an amount of a Food, snapshotted when it was added to the Recipe. */
export interface RecipeIngredient {
  /** The Library item it came from, or null (e.g. an estimate the Library didn't keep). */
  libraryId: string | null;
  name: string;
  amount: number;
  unit: string;
  /** Raw grams that went in, when the Food's gram weight is known. */
  grams?: number | null;
  /** Nutrition of that amount. */
  nutrition: Nutrition;
  /** The Food's Yield ratio (prepared / raw weight), when known; an unweighed Prepared weight is estimated from it. */
  yieldRatio?: number | null;
}

/** A Recipe before it has an id and owner (the builder's draft, or a Recipe logged without saving). */
export interface NewRecipe {
  name: string;
  ingredients: RecipeIngredient[];
  /** Weighed Prepared weight of the finished batch in grams, or null when not weighed. */
  preparedGrams?: number | null;
}

/** A Recipe in the Recipe Book (household Library row RECIPE#<id>). */
export interface Recipe extends NewRecipe {
  id: string;
  /** The Member who first saved it. */
  createdBy: string;
  /** Epoch ms of the last write. */
  updatedAt: number;
}

/** Limits for a Recipe (the API checks the same). */
export const RECIPE_LIMITS = { ingredients: 50, nameLength: 120, unitLength: 30, preparedGrams: 50_000, grams: 100_000 } as const;

/** Rounded to 6 places: per-gram math leaves float noise. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

const amountError = (to: Amount) =>
  to.amount > amountMax(to.unit) ? `Amount must be at most ${amountMax(to.unit)}${to.unit === GRAMS ? " g" : ""}` : "Amount must be more than 0";

export type IngredientResult = { ok: true; ingredient: RecipeIngredient } | { ok: false; error: string };

/** `to` of `food` as an ingredient, or why it can't be (a unit the Food doesn't have, a bad amount). */
export function ingredientFromFood(food: Food, to: Amount): IngredientResult {
  const r = logFood(food, to, "snack");
  if (!r.ok) return r;
  const { name, amount, unit, grams, nutrition } = r.entry;
  return {
    ok: true,
    ingredient: {
      libraryId: food.id || null, name, amount: amount!, unit: unit!, nutrition,
      ...(grams ? { grams } : {}),
      ...(typeof food.yieldRatio === "number" && food.yieldRatio > 0 ? { yieldRatio: food.yieldRatio } : {}),
    },
  };
}

/** Total nutrition: the sum of the ingredients. */
export const recipeTotals = (recipe: Pick<NewRecipe, "ingredients">): Nutrition => sumMacros(recipe.ingredients);

/** Raw weight: the sum of ingredient grams, or null when any ingredient's weight is unknown. */
export function rawWeight(recipe: Pick<NewRecipe, "ingredients">): number | null {
  if (!recipe.ingredients.length || recipe.ingredients.some((i) => !i.grams)) return null;
  return tidy(recipe.ingredients.reduce((t, i) => t + num(i.grams), 0));
}

/** Where a Prepared weight came from: weighed by a Member, or estimated from the Yield ratios. */
export type PreparedWeightSource = "weighed" | "estimated";

/** An ingredient's Yield ratio, or 1 when none is known. */
export const yieldOf = (i: Pick<RecipeIngredient, "yieldRatio">): number =>
  typeof i.yieldRatio === "number" && Number.isFinite(i.yieldRatio) && i.yieldRatio > 0 ? i.yieldRatio : 1;

/**
 * The Recipe's Prepared weight: the weighed value when set, else the sum of each ingredient's grams
 * times its Yield ratio (1 when unknown). Null when not weighed and an ingredient's grams are unknown.
 */
export function preparedWeight(recipe: Pick<NewRecipe, "preparedGrams" | "ingredients">): { grams: number; source: PreparedWeightSource } | null {
  const g = recipe.preparedGrams;
  if (typeof g === "number" && Number.isFinite(g) && g > 0) return { grams: g, source: "weighed" };
  if (rawWeight(recipe) === null) return null;
  return { grams: tidy(recipe.ingredients.reduce((t, i) => t + num(i.grams) * yieldOf(i), 0)), source: "estimated" };
}

export type LogRecipeResult = { ok: true; entry: Omit<Entry, "id"> } | { ok: false; error: string };

/**
 * The Entry (without id) for a portion of `recipe` in `meal`: `amount` g (needs a Prepared weight)
 * or `amount` batch (a fraction of it). Nutrition and the ingredient breakdown are that share of the
 * Recipe; it points at the Recipe when saved (has an id).
 */
export function logRecipe(recipe: NewRecipe & { id?: string | null }, portion: Amount, meal: Meal): LogRecipeResult {
  if (!recipe.ingredients.length) return { ok: false, error: "Add at least one ingredient" };
  if (portion.unit !== GRAMS && portion.unit !== BATCH) return { ok: false, error: `Log a Recipe in ${GRAMS} or as a fraction of the ${BATCH}` };
  if (!isAmount(portion.amount, portion.unit)) return { ok: false, error: amountError(portion) };
  const prepared = preparedWeight(recipe);
  let share: number;
  if (portion.unit === GRAMS) {
    if (!prepared) return { ok: false, error: `Enter the Prepared weight (weigh the finished batch) to log ${recipe.name} in ${GRAMS}` };
    share = portion.amount / prepared.grams;
  } else share = portion.amount;
  const grams = portion.unit === GRAMS ? portion.amount : prepared ? tidy(prepared.grams * share) : null;
  const scale = (n: Nutrition) => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, tidy(num(n[k]) * share)])) as Nutrition;
  const ingredients: EntryIngredient[] = recipe.ingredients.map((i) => ({
    name: i.name, nutrition: scale(i.nutrition), amount: tidy(i.amount * share), unit: i.unit, ...(i.grams ? { grams: tidy(i.grams * share) } : {}),
  }));
  return {
    ok: true,
    entry: {
      meal, name: recipe.name.trim(), amount: portion.amount, unit: portion.unit, nutrition: scale(recipeTotals(recipe)),
      ...(grams ? { grams } : {}), ...(recipe.id ? { libraryId: recipe.id } : {}), ingredients,
    },
  };
}

export type CheckedRecipe = { ok: true; recipe: NewRecipe } | { ok: false; error: string };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const fail = (error: string): CheckedRecipe => ({ ok: false, error });
const clean = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");
const inRange = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;

function checkIngredient(src: RecipeIngredient): RecipeIngredient | string {
  const name = clean(src?.name);
  if (!name || name.length > RECIPE_LIMITS.nameLength) return `Ingredient names must be 1-${RECIPE_LIMITS.nameLength} characters`;
  const unit = clean(src.unit);
  if (!unit || unit.length > RECIPE_LIMITS.unitLength) return `${name}: unit must be 1-${RECIPE_LIMITS.unitLength} characters`;
  if (!isAmount(src.amount, unit)) return `${name}: ${amountError({ amount: num(src.amount), unit })}`;
  if (src.grams !== null && src.grams !== undefined && !inRange(src.grams, RECIPE_LIMITS.grams)) return `${name}: grams must be more than 0 and at most ${RECIPE_LIMITS.grams}`;
  const ref = src.libraryId;
  if (ref !== null && ref !== undefined && (typeof ref !== "string" || !ID_RE.test(ref))) return `${name}: bad Library reference`;
  const y = src.yieldRatio;
  if (y !== null && y !== undefined && !inRange(y, YIELD_MAX)) return `${name}: Yield ratio must be more than 0 and at most ${YIELD_MAX}`;
  const n = (src.nutrition ?? {}) as Record<string, unknown>;
  for (const k of NUTRIENT_KEYS) {
    const v = n[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > NUTRIENT_MAX) return `${name}: ${k} must be a number from 0 to ${NUTRIENT_MAX}`;
  }
  return {
    libraryId: typeof ref === "string" ? ref : null, name, amount: src.amount, unit,
    nutrition: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n[k]])) as Nutrition,
    ...(src.grams ? { grams: src.grams } : {}), ...(y ? { yieldRatio: y } : {}),
  };
}

/** A Recipe as it may be saved (name tidied, unknown fields dropped), or the first thing wrong with it. */
export function checkRecipe(recipe: NewRecipe): CheckedRecipe {
  const name = clean(recipe?.name);
  if (!name) return fail("Give the Recipe a name");
  if (name.length > RECIPE_LIMITS.nameLength) return fail(`Name must be at most ${RECIPE_LIMITS.nameLength} characters`);
  if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) return fail("Add at least one ingredient");
  if (recipe.ingredients.length > RECIPE_LIMITS.ingredients) return fail(`At most ${RECIPE_LIMITS.ingredients} ingredients`);
  const p = recipe.preparedGrams;
  if (p !== null && p !== undefined && !inRange(p, RECIPE_LIMITS.preparedGrams)) return fail(`Prepared weight must be more than 0 and at most ${RECIPE_LIMITS.preparedGrams} g`);
  const ingredients: RecipeIngredient[] = [];
  for (const i of recipe.ingredients) {
    const r = checkIngredient(i);
    if (typeof r === "string") return fail(r);
    ingredients.push(r);
  }
  return { ok: true, recipe: { name, ingredients, preparedGrams: p ?? null } };
}
