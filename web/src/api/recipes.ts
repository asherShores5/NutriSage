// The Recipe Book, part of the shared Library (schema/library.graphql). A Guest keeps their own
// device Recipe Book instead (guest/store.ts). Screens read it through library/useLibrary.ts.
import type { NewRecipe, Recipe } from "@nutrisage/shared";
import { addGuestRecipe, deleteGuestRecipe, guestRecipes, putGuestRecipe } from "../guest/store";
import { isGuest } from "../session";
import { NUTRITION, gql } from "./gql";

const INGREDIENT = `libraryId name amount unit grams nutrition { ${NUTRITION} } yieldRatio`;

/** GraphQL selection for a Recipe (a nested Recipe's breakdown included, one level deep). */
export const RECIPE = `id name ingredients { ${INGREDIENT} ingredients { ${INGREDIENT} } } preparedGrams createdBy updatedAt`;

/** The Recipe as RecipeInput: only the fields the schema takes. */
const asInput = (recipe: NewRecipe) => ({ name: recipe.name, ingredients: recipe.ingredients, preparedGrams: recipe.preparedGrams ?? null });

/** Every Recipe in the Recipe Book. */
export async function getRecipes(): Promise<Recipe[]> {
  if (isGuest()) return guestRecipes();
  return (await gql<{ library: { recipes: Recipe[] } }>(`query { library { recipes { ${RECIPE} } } }`)).library.recipes;
}

/** Save a new Recipe under `id` (chosen here, so the Entry can point at it). A retry returns the saved one. */
export async function addRecipe(id: string, recipe: NewRecipe): Promise<Recipe> {
  if (isGuest()) return addGuestRecipe(id, recipe);
  const r = await gql<{ addRecipe: Recipe }>(
    `mutation ($id: ID!, $input: RecipeInput!) { addRecipe(id: $id, input: $input) { ${RECIPE} } }`,
    { id, input: asInput(recipe) },
  );
  return r.addRecipe;
}

/** Edit a saved Recipe (ingredients, name, Prepared weight). Entries logged from it keep their snapshots. */
export async function putRecipe(id: string, recipe: NewRecipe): Promise<Recipe> {
  if (isGuest()) return putGuestRecipe(id, recipe);
  const r = await gql<{ putRecipe: Recipe }>(
    `mutation ($id: ID!, $input: RecipeInput!) { putRecipe(id: $id, input: $input) { ${RECIPE} } }`,
    { id, input: asInput(recipe) },
  );
  return r.putRecipe;
}

/** Delete a saved Recipe and every Member's Favorite of it. Entries keep their snapshots. */
export async function deleteRecipe(id: string): Promise<string> {
  if (isGuest()) return deleteGuestRecipe(id);
  return (await gql<{ deleteRecipe: string }>(`mutation ($id: ID!) { deleteRecipe(id: $id) }`, { id })).deleteRecipe;
}
