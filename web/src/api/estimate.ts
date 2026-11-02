// Bedrock estimates (schema/estimate.graphql). A Guest uses the capped Guest endpoint instead.
import type { Nutrition } from "@nutrisage/shared";
import { guestEstimate } from "../guest/estimate";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

/** One serving of a typed Food, as Bedrock estimated it. */
export interface Estimate {
  name: string;
  nutrition: Nutrition;
  servingGrams: number | null;
  yieldRatio: number | null;
}

export async function estimate(text: string): Promise<Estimate> {
  if (isGuest()) return guestEstimate(text);
  const q = `mutation($text: String!) { estimate(text: $text) { name nutrition { ${NUTRITION} } servingGrams yieldRatio } }`;
  return (await gql<{ estimate: Estimate }>(q, { text })).estimate;
}
