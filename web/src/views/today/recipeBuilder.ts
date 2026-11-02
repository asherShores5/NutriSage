// The Recipe builder's rules (ticket 17), kept pure so they're testable without a DOM. The Recipe
// math itself (totals, raw weight, portions) is in shared/src/recipe.ts.
import {
  BATCH, checkRecipe, foodFromServing, formatAmount, ingredientFromFood, logRecipe, parseAmount,
  type Entry, type Food, type Meal, type NewRecipe, type RecipeIngredient,
} from "@nutrisage/shared";
import type { Estimate } from "../../api/estimate";

/** One ingredient row as the builder holds it: the Food plus what's typed. */
export interface IngredientRow {
  key: string;
  food: Food;
  /** What's typed ("1 1/2"). */
  amount: string;
  unit: string;
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
    const r = a.ok ? ingredientFromFood(row.food, { amount: a.amount, unit: row.unit }) : a;
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

/** The Recipe to save and the Entry to log for the builder's state; `id` when saving to the Recipe Book. */
export function readBuilder(input: BuilderInput, id?: string): BuilderResult {
  const { ingredients, errors } = readRows(input.rows);
  const rowError = Object.values(errors)[0];
  if (rowError) return { ok: false, error: rowError };
  const prepared = readPrepared(input.prepared);
  if (!prepared.ok) return prepared;
  const checked = checkRecipe({ name: input.name, ingredients, preparedGrams: prepared.grams });
  if (!checked.ok) return checked;
  const a = parseAmount(input.portion, input.portionUnit);
  if (!a.ok) return a;
  const r = logRecipe({ ...checked.recipe, id }, { amount: a.amount, unit: input.portionUnit }, input.meal);
  if (!r.ok) return r;
  return { ok: true, recipe: checked.recipe, entry: r.entry };
}

/** Portion units: a fraction of the batch, or grams of it. */
export const PORTION_UNITS = [BATCH, "g"] as const;
