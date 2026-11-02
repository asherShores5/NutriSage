// The Entry form's rules (estimated or hand-typed), kept pure so they're testable without a DOM.
import {
  GRAMS, NUTRIENTS, SERVING, logFood, parseAmount, scaleSnapshot, servingUnits,
  type Amount, type Entry, type Food, type Meal, type NutrientKey, type Nutrition,
} from "@nutrisage/shared";
import type { Estimate } from "../../api/estimate";

export interface EntryFormValues {
  name: string;
  meal: Meal;
  /** What's typed in each nutrient box: nutrition for 1 serving. */
  values: Record<NutrientKey, string>;
  /** The typed amount of servings ("1 1/2"). */
  amount: string;
}

export type EntryFormResult = { ok: true; entry: Omit<Entry, "id"> } | { ok: false; error: string };

export const blankNutrientValues = (): Record<NutrientKey, string> =>
  Object.fromEntries(NUTRIENTS.map((n) => [n.key, ""])) as Record<NutrientKey, string>;

/** A hand-typed Entry: the typed nutrition is 1 serving, multiplied by the amount. */
export function readEntryForm({ name, meal, values, amount }: EntryFormValues): EntryFormResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the Entry a name" };
  const nutrition = {} as Nutrition;
  for (const n of NUTRIENTS) {
    const raw = values[n.key].trim();
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: `${n.label} must be a number, 0 or more` };
    nutrition[n.key] = v;
  }
  const a = parseAmount(amount, SERVING);
  if (!a.ok) return a;
  const one = { amount: 1, unit: SERVING };
  const r = scaleSnapshot({ nutrition }, one, { amount: a.amount, unit: SERVING }, servingUnits(null));
  if (!r.ok) return r;
  return { ok: true, entry: { meal, name: trimmed, amount: a.amount, unit: SERVING, nutrition: r.nutrition } };
}

/**
 * The Entry for `to` of an estimated serving. Once the estimate is saved to the Library, it logs from
 * that Food (pointing at it); otherwise Bedrock's serving scaled, plus grams when known.
 */
export function entryFromEstimate(est: Estimate, meal: Meal, to: Amount): EntryFormResult {
  if (est.food) return logFood(est.food, to, meal);
  const r = scaleSnapshot({ nutrition: est.nutrition, grams: est.servingGrams }, { amount: 1, unit: SERVING }, to, servingUnits(est.servingGrams));
  if (!r.ok) return r;
  return { ok: true, entry: { meal, name: est.name, amount: to.amount, unit: to.unit, nutrition: r.nutrition, ...(r.grams ? { grams: r.grams } : {}) } };
}

/**
 * Unit labels for the add box: the picked Library Food's own units, serving and g for a new Food
 * (Bedrock gives the serving's weight), only serving by hand.
 */
export function formUnits(picked: Food | undefined, byHand: boolean): string[] {
  if (byHand) return [SERVING];
  return picked ? picked.units.map((u) => u.label) : [SERVING, GRAMS];
}
