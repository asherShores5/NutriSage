// Foods in the Library (spec: Domain model > Food). A Food carries nutrition per gram and named
// units, each with its gram weight: always "serving" and "g", plus any others (e.g. "egg", "cup").
// Logging an amount of a unit is amount x unit grams x nutrition per gram, snapshotted on the Entry.
//
// A Food whose serving weight isn't known (Bedrock gave none, or a migrated Favorite) has only a
// "serving" unit, counted as 1 g so the per-gram math still holds; it offers no "g" until someone
// gives the serving a real weight (Library edit, ticket 15, then rescales nutrition to per gram).
import { amountMax, isAmount } from "./amount";
import type { Entry, Meal } from "./day";
import { NUTRIENT_KEYS, num, type Nutrition } from "./nutrients";
import { GRAMS, SERVING, type Amount, type Unit } from "./scaling";

/** A named unit of a Food and the gram weight of one of it. */
export interface FoodUnit {
  label: string;
  grams: number;
}

/** A Food in the shared Library. */
export interface Food {
  id: string;
  name: string;
  /** Nutrition in one gram (in one serving when the Food has no "g" unit; see above). */
  nutrition: Nutrition;
  /** "serving" first, then "g" when weighed, then any others. */
  units: FoodUnit[];
  /** Prepared weight / raw weight, when known (Recipe ingredients). */
  yieldRatio?: number | null;
  /** The Member who first saved it. */
  createdBy: string;
  /** Epoch ms of the last write. */
  updatedAt: number;
}

/** A Food before it has an id and owner. */
export type NewFood = Omit<Food, "id" | "createdBy" | "updatedAt">;

/** Limits for unit labels and gram weights (the API checks the same). */
export const FOOD_LIMITS = { unitLength: 30, unitGrams: 10_000, units: 12, nameLength: 120 } as const;

/** One serving's nutrition (e.g. a Bedrock estimate) and what's known about its weight. */
export interface ServingInput {
  name: string;
  nutrition: Partial<Record<keyof Nutrition, unknown>>;
  /** Gram weight of that serving, or null when unknown. */
  servingGrams: number | null | undefined;
  /** Other units, e.g. Bedrock's suggestions; bad or repeated ones are dropped. */
  units?: readonly { label: string; grams: number }[];
  yieldRatio?: number | null;
}

const okGrams = (g: unknown): g is number => typeof g === "number" && Number.isFinite(g) && g > 0 && g <= FOOD_LIMITS.unitGrams;
const cleanLabel = (label: unknown) => (typeof label === "string" ? label.trim().replace(/\s+/g, " ").toLowerCase() : "");

/** The Food for one serving: nutrition divided down to one gram, units serving + g + the extras. */
export function foodFromServing({ name, nutrition, servingGrams, units = [], yieldRatio }: ServingInput): NewFood {
  const weighed = okGrams(servingGrams);
  const per = weighed ? servingGrams : 1;
  const out: FoodUnit[] = weighed ? [{ label: SERVING, grams: servingGrams }, { label: GRAMS, grams: 1 }] : [{ label: SERVING, grams: 1 }];
  if (weighed) {
    for (const u of units) {
      const label = cleanLabel(u.label);
      if (!label || label.length > FOOD_LIMITS.unitLength || !okGrams(u.grams) || out.some((x) => x.label === label)) continue;
      if (out.length >= FOOD_LIMITS.units) break;
      out.push({ label, grams: u.grams });
    }
  }
  return {
    name: name.trim(),
    nutrition: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, num(nutrition[k]) / per])) as Nutrition,
    units: out,
    ...(typeof yieldRatio === "number" && yieldRatio > 0 ? { yieldRatio } : {}),
  };
}

/** Whether the Food's gram weights are real (it has a "g" unit). */
export const isWeighed = (food: Pick<Food, "units">) => food.units.some((u) => u.label === GRAMS);

/** The Food's units for the unit picker and scaling (gram weights unknown on an unweighed Food). */
export function foodUnits(food: Pick<Food, "units">): Unit[] {
  const weighed = isWeighed(food);
  return food.units.map((u) => ({ label: u.label, grams: weighed ? u.grams : null }));
}

/** Rounded to 6 places: per-gram math leaves float noise (25 / 182 * 182 = 25.000000000000004). */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

export type LogFoodResult = { ok: true; entry: Omit<Entry, "id"> } | { ok: false; error: string };

/** The Entry (without id) for `to` of `food` in `meal`: a nutrition snapshot plus a reference to the Food. */
export function logFood(food: Food, to: Amount, meal: Meal): LogFoodResult {
  const unit = food.units.find((u) => u.label === to.unit);
  if (!unit) {
    if (to.unit === GRAMS) return { ok: false, error: `No gram weight is known for ${food.name}, so it can't be logged in g` };
    return { ok: false, error: `${food.name} has no unit called ${to.unit}` };
  }
  if (!isAmount(to.amount, to.unit)) {
    const max = amountMax(to.unit);
    return { ok: false, error: to.amount > max ? `Amount must be at most ${max}${to.unit === GRAMS ? " g" : ""}` : "Amount must be more than 0" };
  }
  const grams = tidy(to.amount * unit.grams);
  const nutrition = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, tidy(num(food.nutrition[k]) * to.amount * unit.grams)])) as Nutrition;
  return {
    ok: true,
    entry: { meal, name: food.name, amount: to.amount, unit: to.unit, nutrition, ...(isWeighed(food) ? { grams } : {}), libraryId: food.id },
  };
}

/** A Food name as compared for deduplication: trimmed, single-spaced, lower case. */
export const foodNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The Food with this name, ignoring case and extra spaces. */
export function findFoodByName<F extends Pick<Food, "name">>(foods: readonly F[], name: string): F | undefined {
  const key = foodNameKey(name);
  return key ? foods.find((f) => foodNameKey(f.name) === key) : undefined;
}
