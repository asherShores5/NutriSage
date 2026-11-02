// Goals (schema/goals.graphql). A Guest's goals come from this device instead (guest/store.ts).
import type { Goals } from "@nutrisage/shared";
import { guestGoals, putGuestGoals } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

const GOALS = `${NUTRITION} water`;

export async function getGoals(): Promise<Goals> {
  if (isGuest()) return guestGoals();
  return (await gql<{ goals: Goals }>(`query { goals { ${GOALS} } }`)).goals;
}

/** Replace the Member's goals (every nutrient and water). */
export async function putGoals(goals: Goals): Promise<Goals> {
  if (isGuest()) return putGuestGoals(goals);
  return (await gql<{ putGoals: Goals }>(`mutation($input: GoalsInput!) { putGoals(input: $input) { ${GOALS} } }`, { input: goals })).putGoals;
}
