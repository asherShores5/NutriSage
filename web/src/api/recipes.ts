// The Recipe Book, part of the shared Library (schema/library.graphql). A Guest saves to their own
// device Recipe Book instead (guest/store.ts). Searching, starring and editing Recipes: ticket 19.
import type { NewRecipe, Recipe } from "@nutrisage/shared";
import { addGuestRecipe } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

/** GraphQL selection for a Recipe. */
export const RECIPE = `id name ingredients { libraryId name amount unit grams nutrition { ${NUTRITION} } yieldRatio } preparedGrams createdBy updatedAt`;

/** Save a new Recipe under `id` (chosen here, so the Entry can point at it). A retry returns the saved one. */
export async function addRecipe(id: string, recipe: NewRecipe): Promise<Recipe> {
  if (isGuest()) return addGuestRecipe(id, recipe);
  const input = { name: recipe.name, ingredients: recipe.ingredients, preparedGrams: recipe.preparedGrams ?? null };
  const r = await gql<{ addRecipe: Recipe }>(
    `mutation ($id: ID!, $input: RecipeInput!) { addRecipe(id: $id, input: $input) { ${RECIPE} } }`,
    { id, input },
  );
  return r.addRecipe;
}
