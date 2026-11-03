// Meal windows (schema/mealWindows.graphql). A Guest's come from this device instead (guest/store.ts).
import type { MealWindows } from "@nutrisage/shared";
import { guestMealWindows, putGuestMealWindows } from "../guest/store";
import { isGuest } from "../session";
import { gql } from "./gql";

const WINDOWS = `breakfast lunch dinner dessert snack`;

export async function getMealWindows(): Promise<MealWindows> {
  if (isGuest()) return guestMealWindows();
  return (await gql<{ mealWindows: MealWindows }>(`query { mealWindows { ${WINDOWS} } }`)).mealWindows;
}

/** Replace the Member's Meal windows (a start time for every Meal). */
export async function putMealWindows(windows: MealWindows): Promise<MealWindows> {
  if (isGuest()) return putGuestMealWindows(windows);
  return (await gql<{ putMealWindows: MealWindows }>(`mutation($input: MealWindowsInput!) { putMealWindows(input: $input) { ${WINDOWS} } }`, { input: windows })).putMealWindows;
}
