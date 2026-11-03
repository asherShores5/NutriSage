// Favorites (schema/favorites.graphql), per Member. A Guest's Favorites live on this device
// instead (guest/store.ts). Screens read them through library/useFavorites.ts, which goes through
// the Member's local copy and outbox (sync/memberData.ts).
import type { Favorite } from "@nutrisage/shared";
import { deleteGuestFavorite, guestFavorites, putGuestFavorite } from "../guest/store";
import { isGuest } from "../session";
import { gql } from "./gql";

const FAVORITE = "libraryId lastUsed";

export async function getFavorites(): Promise<Favorite[]> {
  if (isGuest()) return guestFavorites();
  return (await gql<{ favorites: Favorite[] }>(`query { favorites { ${FAVORITE} } }`)).favorites;
}

/** Star an item or bump its last-used time. Resolves with the stored Favorite (a newer stored time wins). */
export async function putFavorite(favorite: Favorite): Promise<Favorite> {
  if (isGuest()) return putGuestFavorite(favorite);
  const input = { libraryId: favorite.libraryId, lastUsed: favorite.lastUsed };
  return (await gql<{ putFavorite: Favorite }>(`mutation($input: FavoriteInput!) { putFavorite(input: $input) { ${FAVORITE} } }`, { input })).putFavorite;
}

/** Unstar an item. */
export async function deleteFavorite(libraryId: string): Promise<string> {
  if (isGuest()) return deleteGuestFavorite(libraryId);
  return (await gql<{ deleteFavorite: string }>(`mutation($id: ID!) { deleteFavorite(libraryId: $id) }`, { id: libraryId })).deleteFavorite;
}
