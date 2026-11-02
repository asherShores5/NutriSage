// The shared Library (schema/library.graphql). A Guest gets their own device Library instead
// (guest/store.ts) and never the household's. Screens read it through library/useLibrary.ts.
import { foodEdit, type Food, type FoodEdit } from "@nutrisage/shared";
import { deleteGuestFood, guestLibrary, putGuestFood } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

/** GraphQL selection for a Food. */
export const FOOD = `id name nutrition { ${NUTRITION} } units { label grams } yieldRatio createdBy updatedAt`;

/** Every Food in the Library. */
export async function getLibrary(): Promise<Food[]> {
  if (isGuest()) return guestLibrary();
  return (await gql<{ library: { foods: Food[] } }>(`query { library { foods { ${FOOD} } } }`)).library.foods;
}

/** Edit a Library Food (nutrition per serving in the form; stored per gram). Entries keep their snapshots. */
export async function putFood(id: string, edit: FoodEdit): Promise<Food> {
  if (isGuest()) return putGuestFood(id, edit);
  const r = await gql<{ putFood: Food }>(
    `mutation ($id: ID!, $input: FoodEditInput!) { putFood(id: $id, input: $input) { ${FOOD} } }`,
    { id, input: edit },
  );
  return r.putFood;
}

/** Delete a Library Food and every Member's Favorite of it. Entries keep their snapshots. */
export async function deleteFood(id: string): Promise<string> {
  if (isGuest()) return deleteGuestFood(id);
  return (await gql<{ deleteFood: string }>(`mutation ($id: ID!) { deleteFood(id: $id) }`, { id })).deleteFood;
}

/**
 * Bedrock's Yield ratio for a Library Food that has none, saved on the Food (the Recipe builder
 * asks). A Guest's Food comes back unchanged: suggestions would spend the Guest's capped estimates.
 */
export async function suggestYieldRatio(food: Food): Promise<Food> {
  if (isGuest()) return food;
  return (await gql<{ suggestYieldRatio: Food }>(`mutation ($id: ID!) { suggestYieldRatio(id: $id) { ${FOOD} } }`, { id: food.id })).suggestYieldRatio;
}

/** Save a Food's Yield ratio (null clears it) through the Library edit, keeping everything else as `food` has it. */
export const putYieldRatio = (food: Food, yieldRatio: number | null): Promise<Food> => putFood(food.id, { ...foodEdit(food), yieldRatio });
