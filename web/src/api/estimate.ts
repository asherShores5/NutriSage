// Bedrock estimates (schema/estimate.graphql).
import type { Nutrition } from "@nutrisage/shared";
import { NUTRITION, gql } from "./gql";

/** One serving of a typed Food, as Bedrock estimated it. */
export interface Estimate {
  name: string;
  nutrition: Nutrition;
  servingGrams: number | null;
  yieldRatio: number | null;
}

export async function estimate(text: string): Promise<Estimate> {
  const q = `mutation($text: String!) { estimate(text: $text) { name nutrition { ${NUTRITION} } servingGrams yieldRatio } }`;
  return (await gql<{ estimate: Estimate }>(q, { text })).estimate;
}
