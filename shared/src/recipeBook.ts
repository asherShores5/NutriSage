// The Recipe Book (ticket 19; GLOSSARY: Recipe Book, Library, Quick Add): saved Recipes beside the
// Foods in the Library, searchable, starrable and logged like Foods, and usable as an ingredient of
// another Recipe one level deep (spec: Out of scope > nesting deeper than one level).
//
// Nesting is checked twice: structurally by checkRecipe (an ingredient's breakdown can't hold a
// breakdown), and against the Recipe Book by nestingError (an ingredient pointing at a saved Recipe
// that has a Recipe in it, a Recipe inside itself, or giving a Recipe a Recipe ingredient while
// another Recipe uses it). Together they keep every saved Recipe at most one level deep.
import type { Meal } from "./day";
import { logFood, type Food, type LogFoodResult } from "./food";
import { BATCH, logRecipe, preparedWeight, type IngredientResult, type NestedIngredient, type NewRecipe, type Recipe, type RecipeIngredient } from "./recipe";
import { amountMax, isAmount } from "./amount";
import { NUTRIENT_KEYS, num, type Nutrition } from "./nutrients";
import { GRAMS, type Amount } from "./scaling";

/** Anything in the Library: a Food or a Recipe. */
export type LibraryItem = Food | Recipe;

/** Whether a Library item is a Recipe (it has ingredients; a Food has units). */
export const isRecipe = (item: LibraryItem): item is Recipe => Array.isArray((item as Recipe).ingredients);

const NEST_ONE_LEVEL = "Recipes nest only one level deep";

/** Whether this ingredient is a portion of a saved Recipe (it carries that Recipe's breakdown). */
const isNested = (i: RecipeIngredient, recipeIds?: ReadonlySet<string>) =>
  (Array.isArray(i.ingredients) && i.ingredients.length > 0) || (!!i.libraryId && !!recipeIds?.has(i.libraryId));

/** Whether a Recipe has a saved Recipe among its ingredients (by breakdown, or by id when the Recipe Book's ids are given). */
export const containsRecipe = (recipe: Pick<NewRecipe, "ingredients">, recipeIds?: ReadonlySet<string>) =>
  recipe.ingredients.some((i) => isNested(i, recipeIds));

/**
 * `portion` (g or a fraction of the batch) of a saved Recipe as an ingredient of another Recipe:
 * that share of its nutrition and grams, pointing at it, with its own breakdown. It has no Yield
 * ratio: it is already prepared, so it counts at its own weight. A Recipe that already has a
 * Recipe in it can't be used (one level deep).
 */
export function ingredientFromRecipe(recipe: Recipe, portion: Amount): IngredientResult {
  if (containsRecipe(recipe)) return { ok: false, error: `${recipe.name} already has a Recipe in it, and ${NEST_ONE_LEVEL}` };
  const r = logRecipe(recipe, portion, "snack");
  if (!r.ok) return r;
  const { name, amount, unit, grams, nutrition } = r.entry;
  const ingredients: NestedIngredient[] = (r.entry.ingredients ?? []).map((e, i) => {
    const src = recipe.ingredients[i];
    return {
      libraryId: src.libraryId ?? null, name: e.name, amount: e.amount ?? src.amount, unit: e.unit ?? src.unit, nutrition: e.nutrition,
      ...(e.grams ? { grams: e.grams } : {}), ...(src.yieldRatio ? { yieldRatio: src.yieldRatio } : {}),
    };
  });
  return { ok: true, ingredient: { libraryId: recipe.id, name, amount: amount!, unit: unit!, nutrition, ...(grams ? { grams } : {}), ingredients } };
}

/**
 * Why `recipe` (new, or an edit of a saved one when it has an id) can't be saved beside `book`
 * (the Recipe Book as it is), or null. See the header for the three rules.
 */
export function nestingError(recipe: NewRecipe & { id?: string | null }, book: readonly Recipe[]): string | null {
  const ids = new Set(book.map((r) => r.id));
  if (recipe.id && recipe.ingredients.some((i) => i.libraryId === recipe.id)) return "A Recipe can't be an ingredient of itself";
  const byId = new Map(book.map((r) => [r.id, r]));
  for (const i of recipe.ingredients) {
    const ref = i.libraryId ? byId.get(i.libraryId) : undefined;
    if (ref && containsRecipe(ref, ids)) return `${ref.name} already has a Recipe in it, and ${NEST_ONE_LEVEL}`;
  }
  if (recipe.id && containsRecipe(recipe, ids)) {
    const user = book.find((r) => r.id !== recipe.id && r.ingredients.some((i) => i.libraryId === recipe.id));
    if (user) return `${recipe.name.trim()} is an ingredient of ${user.name}, so it can't have a Recipe in it (${NEST_ONE_LEVEL})`;
  }
  return null;
}

/** The units a Recipe logs in: a fraction of the batch, and g once its Prepared weight is known. */
export const recipeUnits = (recipe: Pick<NewRecipe, "ingredients" | "preparedGrams">): string[] =>
  preparedWeight(recipe) ? [BATCH, GRAMS] : [BATCH];

/**
 * What a Recipe logs when no portion was picked for it (Quick Add, or the add box's serving): a
 * quarter of the batch, the builder's usual split. The amount can be changed on the Entry after.
 */
export const QUICK_ADD_PORTION: Readonly<Amount> = { amount: 0.25, unit: BATCH };

/** `to` when the Recipe logs in that unit, else the Quick Add portion. */
export const recipePortion = (recipe: Recipe, to: Amount): Amount =>
  recipeUnits(recipe).includes(to.unit) ? to : { ...QUICK_ADD_PORTION };

/** The Entry for `to` of any Library item: a Food in its units, a Recipe by its portion (see recipePortion). */
export function logLibraryItem(item: LibraryItem, to: Amount, meal: Meal): LogFoodResult {
  return isRecipe(item) ? logRecipe(item, recipePortion(item, to), meal) : logFood(item, to, meal);
}

/** The units an ingredient already in a Recipe can be changed to: its own, plus g when its grams are known. */
export const ingredientUnits = (i: Pick<RecipeIngredient, "unit" | "grams">): string[] =>
  i.unit === GRAMS || !i.grams ? [i.unit] : [i.unit, GRAMS];

/** Rounded to 6 places: per-gram math leaves float noise. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * An ingredient already in a Recipe at a new amount (in its unit, or g when its grams are known):
 * its snapshot scaled, nested breakdown included, so editing a Recipe never re-reads a Food that
 * may have changed since. The same amount and unit return it unchanged.
 */
export function rescaleIngredient(i: RecipeIngredient, to: Amount): IngredientResult {
  if (!isAmount(to.amount, to.unit)) return { ok: false, error: to.amount > amountMax(to.unit) ? `Amount must be at most ${amountMax(to.unit)}${to.unit === GRAMS ? " g" : ""}` : "Amount must be more than 0" };
  if (to.unit === i.unit && to.amount === i.amount) return { ok: true, ingredient: i };
  let factor: number;
  if (to.unit === i.unit) factor = to.amount / i.amount;
  else if (to.unit === GRAMS && i.grams) factor = to.amount / i.grams;
  else return { ok: false, error: `No gram weight is known for ${i.name}, so it can't be changed to ${to.unit}` };
  const scale = <T extends NestedIngredient>(x: T): T => ({
    ...x,
    nutrition: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, tidy(num(x.nutrition[k]) * factor)])) as Nutrition,
    amount: tidy(x.amount * factor),
    ...(x.grams ? { grams: tidy(x.grams * factor) } : {}),
  });
  const out = { ...scale(i), amount: to.amount, unit: to.unit } as RecipeIngredient;
  if (i.ingredients?.length) out.ingredients = i.ingredients.map(scale);
  return { ok: true, ingredient: out };
}
