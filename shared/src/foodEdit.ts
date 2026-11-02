// Library edit (ticket 15): a Food as the edit form shows it, and back. People think in servings,
// so nutrition is entered per serving and stored per gram (see food.ts). Giving an unweighed Food a
// serving weight rescales its nutrition to per gram and adds the "g" unit.
import { FOOD_LIMITS, foodFromServing, isWeighed, type Food, type FoodUnit, type NewFood } from "./food";
import { GRAMS, SERVING } from "./scaling";
import { NUTRIENT_KEYS, num, type Nutrition } from "./nutrients";

/** The editable parts of a Food, as the form holds them. */
export interface FoodEdit {
  name: string;
  /** Nutrition in one serving. */
  nutrition: Nutrition;
  /** Grams in one serving, or null when unknown. */
  servingGrams: number | null;
  /** Units other than serving and g. */
  units: FoodUnit[];
  yieldRatio: number | null;
}

/** Rounded to 6 places: per-gram math leaves float noise. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/** A Library Food as the edit form shows it. */
export function foodEdit(food: Food): FoodEdit {
  const weighed = isWeighed(food);
  const serving = food.units.find((u) => u.label === SERVING)?.grams ?? 1;
  const per = weighed ? serving : 1;
  return {
    name: food.name,
    nutrition: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, tidy(num(food.nutrition[k]) * per)])) as Nutrition,
    servingGrams: weighed ? serving : null,
    units: weighed ? food.units.filter((u) => u.label !== SERVING && u.label !== GRAMS).map((u) => ({ ...u })) : [],
    yieldRatio: typeof food.yieldRatio === "number" && food.yieldRatio > 0 ? food.yieldRatio : null,
  };
}

/** Largest Yield ratio accepted (dry beans swell about x3; anything near 20 is a typo). */
export const YIELD_MAX = 20;

/** Largest amount of any nutrient in one serving (the API's Day limit is the same). */
export const NUTRIENT_MAX = 100_000;

export type EditedFood = { ok: true; food: NewFood } | { ok: false; error: string };

const fail = (error: string): EditedFood => ({ ok: false, error });
const okGrams = (g: unknown): g is number => typeof g === "number" && Number.isFinite(g) && g > 0 && g <= FOOD_LIMITS.unitGrams;
const unitLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** The form back to a Food stored per gram, or the first thing wrong with it (in plain words). */
export function editedFood(edit: FoodEdit): EditedFood {
  const name = edit.name.trim().replace(/\s+/g, " ");
  if (!name) return fail("Give the Food a name");
  if (name.length > FOOD_LIMITS.nameLength) return fail(`Name must be at most ${FOOD_LIMITS.nameLength} characters`);
  for (const k of NUTRIENT_KEYS) {
    const v = edit.nutrition[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > NUTRIENT_MAX) return fail(`${k} must be a number from 0 to ${NUTRIENT_MAX}`);
  }
  const { servingGrams } = edit;
  if (servingGrams !== null && !okGrams(servingGrams)) return fail(`Serving weight must be more than 0 and at most ${FOOD_LIMITS.unitGrams} g`);
  const others = FOOD_LIMITS.units - 2;
  if (edit.units.length > others) return fail(`At most ${others} other units`);
  if (edit.units.length && servingGrams === null) return fail("Give the serving a weight before adding other units");
  const seen = new Set<string>();
  for (const u of edit.units) {
    const label = unitLabel(u.label);
    if (!label) return fail("Every unit needs a name");
    if (label.length > FOOD_LIMITS.unitLength) return fail(`Unit names must be at most ${FOOD_LIMITS.unitLength} characters`);
    if (label === GRAMS || label === SERVING) return fail(`${GRAMS} and ${SERVING} are always there; pick another unit name`);
    if (seen.has(label)) return fail(`There are two units called ${label}`);
    seen.add(label);
    if (!okGrams(u.grams)) return fail(`A ${label} must weigh more than 0 and at most ${FOOD_LIMITS.unitGrams} g`);
  }
  const y = edit.yieldRatio;
  if (y !== null && !(typeof y === "number" && Number.isFinite(y) && y > 0 && y <= YIELD_MAX)) return fail(`Yield ratio must be more than 0 and at most ${YIELD_MAX}`);
  return { ok: true, food: foodFromServing({ name, nutrition: edit.nutrition, servingGrams, units: edit.units, yieldRatio: y }) };
}
