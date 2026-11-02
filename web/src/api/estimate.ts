// Bedrock estimates (schema/estimate.graphql). A Guest uses the capped Guest endpoint instead.
import type { Food, FoodUnit, Nutrition } from "@nutrisage/shared";
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
 * `ingredient` (the Recipe builder) also asks for the Food's Yield ratio.
 */
export async function estimate(text: string, opts: { ingredient?: boolean } = {}): Promise<Estimate> {
  const ingredient = opts.ingredient === true;
  if (isGuest()) {
    const est = await guestEstimate(text, { ingredient });
    const units = Array.isArray(est.units) ? est.units : [];
    return { ...est, units, food: addGuestFood({ ...est, units }) };
  }
  const q = `mutation($text: String!, $ingredient: Boolean) { estimate(text: $text, ingredient: $ingredient) { name nutrition { ${NUTRITION} } servingGrams yieldRatio units { label grams } food { ${FOOD} } } }`;
  return (await gql<{ estimate: Estimate }>(q, { text, ...(ingredient ? { ingredient } : {}) })).estimate;
}
