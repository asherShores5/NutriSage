// The Entry form's rules (estimated or hand-typed), kept pure so they're testable without a DOM.
import { NUTRIENTS, type Entry, type Meal, type NutrientKey, type Nutrition } from "@nutrisage/shared";
import type { Estimate } from "../../api/estimate";

export interface EntryFormValues {
  name: string;
  meal: Meal;
  /** What's typed in each nutrient box. */
  values: Record<NutrientKey, string>;
}

export type EntryFormResult = { ok: true; entry: Omit<Entry, "id"> } | { ok: false; error: string };

export const blankNutrientValues = (): Record<NutrientKey, string> =>
  Object.fromEntries(NUTRIENTS.map((n) => [n.key, ""])) as Record<NutrientKey, string>;

export function readEntryForm({ name, meal, values }: EntryFormValues): EntryFormResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the Entry a name" };
  const nutrition = {} as Nutrition;
  for (const n of NUTRIENTS) {
    const raw = values[n.key].trim();
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: `${n.label} must be a number, 0 or more` };
    nutrition[n.key] = v;
  }
  return { ok: true, entry: { meal, name: trimmed, nutrition } };
}

/** The Entry for one estimated serving: Bedrock's nutrition snapshot plus its gram weight when known. */
export function entryFromEstimate(est: Estimate, meal: Meal): Omit<Entry, "id"> {
  return { meal, name: est.name, nutrition: est.nutrition, ...(est.servingGrams ? { grams: est.servingGrams } : {}) };
}
