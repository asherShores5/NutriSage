// Bedrock estimates (schema/estimate.graphql). A Guest uses the capped Guest endpoint instead.
import { portionedServing, type Amount, type Food, type FoodUnit, type Nutrition } from "@nutrisage/shared";
import { guestEstimate } from "../guest/estimate";
import { addGuestFood } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";
import { FOOD } from "./library";

/** One serving of a typed Food, as Bedrock estimated it. */
export interface Estimate {
  name: string;
  nutrition: Nutrition;
  servingGrams: number | null;
  yieldRatio: number | null;
  /** Other units Bedrock suggests, with the gram weight of one. */
  units: FoodUnit[];
  /** The Library Food it was saved as (or the existing one with that name); null when nothing was saved. */
  food: Food | null;
}

/**
 * Estimate one serving of `text`; it is saved to the Library too (a Guest's own, on this device).
 * `ingredient` (the Recipe builder) also asks for the Food's Yield ratio. `portion` (the add box,
 * a new Food in a unit other than serving) estimates exactly that amount, and the Food gets that unit.
 */
export async function estimate(text: string, opts: { ingredient?: boolean; portion?: Amount } = {}): Promise<Estimate> {
  const ingredient = opts.ingredient === true;
  const portion = opts.portion;
  if (isGuest()) {
    const est = await guestEstimate(text, { ingredient, portion });
    const units = Array.isArray(est.units) ? est.units : [];
    const serving = { ...est, units };
    return { ...serving, food: addGuestFood(portion ? portionedServing(serving, portion) : serving) };
  }
  const q = `mutation($text: String!, $ingredient: Boolean, $amount: Float, $unit: String) { estimate(text: $text, ingredient: $ingredient, amount: $amount, unit: $unit) { name nutrition { ${NUTRITION} } servingGrams yieldRatio units { label grams } food { ${FOOD} } } }`;
  return (await gql<{ estimate: Estimate }>(q, { text, ...(ingredient ? { ingredient } : {}), ...(portion ? portion : {}) })).estimate;
}
