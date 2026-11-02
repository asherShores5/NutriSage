// Goals (schema/goals.graphql).
import type { Goals } from "@nutrisage/shared";
import { NUTRITION, gql } from "./gql";

const GOALS = `${NUTRITION} water`;

export async function getGoals(): Promise<Goals> {
  return (await gql<{ goals: Goals }>(`query { goals { ${GOALS} } }`)).goals;
}

/** Replace the Member's goals (every nutrient and water). */
export async function putGoals(goals: Goals): Promise<Goals> {
  return (await gql<{ putGoals: Goals }>(`mutation($input: GoalsInput!) { putGoals(input: $input) { ${GOALS} } }`, { input: goals })).putGoals;
}
