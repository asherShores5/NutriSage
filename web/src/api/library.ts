// The shared Library (schema/library.graphql). A Guest gets their own device Library instead
// (guest/store.ts) and never the household's. Screens read it through library/useLibrary.ts.
import type { Food } from "@nutrisage/shared";
import { guestLibrary } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

/** GraphQL selection for a Food. */
export const FOOD = `id name nutrition { ${NUTRITION} } units { label grams } yieldRatio createdBy updatedAt`;

/** Every Food in the Library. */
export async function getLibrary(): Promise<Food[]> {
  if (isGuest()) return guestLibrary();
  return (await gql<{ library: { foods: Food[] } }>(`query { library { foods { ${FOOD} } } }`)).library.foods;
}
