// Meal windows (schema/mealWindows.graphql).
import type { MealWindows } from "@nutrisage/shared";
import { gql } from "./gql";

const WINDOWS = `breakfast lunch dinner dessert snack`;

export async function getMealWindows(): Promise<MealWindows> {
  return (await gql<{ mealWindows: MealWindows }>(`query { mealWindows { ${WINDOWS} } }`)).mealWindows;
}

/** Replace the Member's Meal windows (a start time for every Meal). */
export async function putMealWindows(windows: MealWindows): Promise<MealWindows> {
  return (await gql<{ putMealWindows: MealWindows }>(`mutation($input: MealWindowsInput!) { putMealWindows(input: $input) { ${WINDOWS} } }`, { input: windows })).putMealWindows;
}
