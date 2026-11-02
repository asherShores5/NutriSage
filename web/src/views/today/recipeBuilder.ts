// The Recipe builder's rules (ticket 17), kept pure so they're testable without a DOM. The Recipe
// math itself (totals, raw weight, portions) is in shared/src/recipe.ts.
import {
  BATCH, YIELD_MAX, checkRecipe, foodFromServing, formatAmount, ingredientFromFood, ingredientFromRecipe, ingredientUnits, isWeighed, logRecipe,
  parseAmount, recipeUnits, rescaleIngredient,
  type Entry, type Food, type Meal, type NewRecipe, type PreparedWeightSource, type Recipe, type RecipeIngredient,
} from "@nutrisage/shared";
import type { Estimate } from "../../api/estimate";

/**
 * One ingredient row as the builder holds it: what it is plus what's typed. A Food from the Library
 * or an estimate; a saved Recipe (ticket 19, a portion of it, one level deep); or, when editing a
 * saved Recipe, the ingredient as it was saved (its snapshot, rescaled if the amount changes).
 */
export type IngredientRow = { key: string; /** What's typed ("1 1/2"). */ amount: string; unit: string } & (
  | { food: Food; recipe?: undefined; saved?: undefined }
  | { recipe: Recipe; food?: undefined; saved?: undefined }
  | { saved: RecipeIngredient; food?: undefined; recipe?: undefined }
);

/** The row's ingredient name. */
export const rowName = (row: IngredientRow) => (row.food ?? row.recipe ?? row.saved).name;

/** The units the row's amount can be in. */
export function rowUnits(row: IngredientRow): string[] {
  if (row.food) return row.food.units.map((u) => u.label);
  if (row.recipe) return recipeUnits(row.recipe);
  return ingredientUnits(row.saved);
}

/** A saved Recipe's ingredients as rows, to edit it. */
export const rowsFromRecipe = (recipe: Recipe): IngredientRow[] =>
  recipe.ingredients.map((saved, i) => ({ key: `saved-${i}`, saved, amount: formatAmount(saved.amount), unit: saved.unit }));

function rowIngredient(row: IngredientRow, to: { amount: number; unit: string }) {
  if (row.food) return ingredientFromFood(row.food, to);
  if (row.recipe) return ingredientFromRecipe(row.recipe, to);
  return rescaleIngredient(row.saved, to);
}

/** Each row as an ingredient, or its message (bad amount, unit the Food lacks). */
export function readRows(rows: readonly IngredientRow[]): {
  ingredients: RecipeIngredient[];
  byKey: Record<string, RecipeIngredient>;
  errors: Record<string, string>;
} {
  const byKey: Record<string, RecipeIngredient> = {};
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const a = parseAmount(row.amount, row.unit);
    const r = a.ok ? rowIngredient(row, { amount: a.amount, unit: row.unit }) : a;
    if (r.ok) byKey[row.key] = r.ingredient;
    else errors[row.key] = r.error;
  }
  return { ingredients: rows.flatMap((r) => byKey[r.key] ?? []), byKey, errors };
}

/** The portion typed in `from`, as the same share of the batch in `to` (needs the Prepared weight), else `text` as is. */
export function switchPortionUnit(text: string, from: string, to: string, preparedGrams: number | null): string {
  const a = parseAmount(text, from);
  if (!a.ok || !preparedGrams || from === to) return text;
  if (to === "g") return String(Math.max(1, Math.round(a.amount * preparedGrams)));
  return formatAmount(a.amount / preparedGrams);
}

/** The typed Prepared weight: null when blank (not weighed), else grams, or a message. */
export function readPrepared(text: string): { ok: true; grams: number | null } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  if (!t) return { ok: true, grams: null };
  const g = Number(t);
  if (!Number.isFinite(g) || g <= 0) return { ok: false, error: "Prepared weight must be a number of grams, more than 0" };
  return { ok: true, grams: g };
}

/** What the builder says under the Prepared weight: weighed, estimated (and how much), or what's missing. */
export function preparedNote(weight: { grams: number; source: PreparedWeightSource } | null): string {
  if (!weight) return "Not known (an ingredient has no gram weight): weigh the batch to log in g, or log a fraction of it";
  if (weight.source === "weighed") return "Weighed";
  return `Estimated ${Math.round(weight.grams)} g from Yield ratios. Weigh the batch for exact portions.`;
}

/** A typed Yield ratio: blank is unknown (counted as 1), else a number more than 0 and at most YIELD_MAX. */
export function readYieldRatio(text: string): { ok: true; ratio: number | null } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  if (!t) return { ok: true, ratio: null };
  const y = Number(t);
  if (!Number.isFinite(y) || y <= 0 || y > YIELD_MAX) return { ok: false, error: `Yield ratio must be more than 0 and at most ${YIELD_MAX}` };
  return { ok: true, ratio: y };
}

/** `food` with Yield ratio `ratio` (none when null). */
export function withYieldRatio(food: Food, ratio: number | null): Food {
  const { yieldRatio: _old, ...rest } = food;
  return ratio ? { ...rest, yieldRatio: ratio } : rest;
}

/** Whether to ask Bedrock for a Yield ratio: a Library Food with none whose gram weight is known (else there's no estimate to make). */
export const needsYieldSuggestion = (food: Food): boolean =>
  !!food.id && !(typeof food.yieldRatio === "number" && food.yieldRatio > 0) && isWeighed(food);

/** The Food an ingredient estimate gives: the Library's, or (when it wasn't saved) one with no id. */
export function foodFromEstimate(est: Estimate): Food {
  return est.food ?? { id: "", ...foodFromServing({ ...est, servingGrams: est.servingGrams }), createdBy: "", updatedAt: 0 };
}

export interface BuilderInput {
  name: string;
  rows: readonly IngredientRow[];
  prepared: string;
  portion: string;
  portionUnit: string;
  meal: Meal;
}

export type BuilderResult = { ok: true; recipe: NewRecipe; entry: Omit<Entry, "id"> } | { ok: false; error: string };

export type EditInput = Pick<BuilderInput, "name" | "rows" | "prepared">;

/** The Recipe as the builder's boxes describe it (editing a saved one saves just this), or the first thing wrong. */
export function readEdit(input: EditInput): { ok: true; recipe: NewRecipe } | { ok: false; error: string } {
  const { ingredients, errors } = readRows(input.rows);
  const rowError = Object.values(errors)[0];
  if (rowError) return { ok: false, error: rowError };
  const prepared = readPrepared(input.prepared);
  if (!prepared.ok) return prepared;
  return checkRecipe({ name: input.name, ingredients, preparedGrams: prepared.grams });
}

/** The Recipe to save and the Entry to log for the builder's state; `id` when saving to the Recipe Book. */
export function readBuilder(input: BuilderInput, id?: string): BuilderResult {
  const checked = readEdit(input);
  if (!checked.ok) return checked;
  const a = parseAmount(input.portion, input.portionUnit);
  if (!a.ok) return a;
  const r = logRecipe({ ...checked.recipe, id }, { amount: a.amount, unit: input.portionUnit }, input.meal);
  if (!r.ok) return r;
  return { ok: true, recipe: checked.recipe, entry: r.entry };
}

/** Portion units: a fraction of the batch, or grams of it. */
export const PORTION_UNITS = [BATCH, "g"] as const;
