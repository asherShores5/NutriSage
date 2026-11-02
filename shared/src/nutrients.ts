// The one nutrient list every layer shares (spec: Domain model > Nutrients). Adding a nutrient is a
// change here, plus the Bedrock prompt (api) and any UI that lists nutrients by name.
// Ported from the old docs/macros.js (MACRO_KEYS, num, sumMacros, pct).

export const NUTRIENTS = [
  { key: "carbs", label: "Carbs", unit: "g", group: "macro" },
  { key: "protein", label: "Protein", unit: "g", group: "macro" },
  { key: "fat", label: "Fat", unit: "g", group: "macro" },
  { key: "fiber", label: "Fiber", unit: "g", group: "micro" },
  { key: "sodium", label: "Sodium", unit: "mg", group: "micro" },
  { key: "iron", label: "Iron", unit: "mg", group: "micro" },
  { key: "calories", label: "Calories", unit: "cal", group: "macro" },
] as const;

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export const NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENTS.map((n) => n.key);

/** Amounts of every tracked nutrient. Always complete: missing values are 0, never undefined. */
export type Nutrition = Record<NutrientKey, number>;

/** A number, or 0 for anything that isn't a finite one ("abc", undefined, NaN). Keeps totals from going NaN. */
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function emptyNutrition(): Nutrition {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Nutrition;
}

/** Anything with a (possibly partial or junk) nutrition snapshot, e.g. an Entry. */
export interface HasNutrition {
  nutrition?: Partial<Record<NutrientKey, unknown>> | null;
}

/** Totals of each nutrient across Entries. Missing or non-numeric values count as 0. */
export function sumMacros(entries: readonly (HasNutrition | null | undefined)[] | null | undefined): Nutrition {
  const acc = emptyNutrition();
  for (const e of entries ?? []) {
    for (const k of NUTRIENT_KEYS) acc[k] += num(e?.nutrition?.[k]);
  }
  return acc;
}

/** `value` as a whole-number percent of `goal`, clamped to 0-100; 0 when there's no goal. */
export function pct(value: unknown, goal: number | null | undefined): number {
  if (!goal || goal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num(value) / goal) * 100)));
}
