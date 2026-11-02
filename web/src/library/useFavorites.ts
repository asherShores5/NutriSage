// The Member's Favorites and Quick Add, for every screen that shows a star or Quick Add (Today's
// Entries and Quick Add row; search ranking, ticket 13; Library edit, ticket 15). Kept in the
// Member's local copy (sync/memberData.ts) and written through the outbox like Days and goals, so
// starring works offline; a Guest's Favorites stay on the device (api/favorites.ts).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { quickAdd, type Favorite, type LibraryItem } from "@nutrisage/shared";
import { currentFavorites, favoritesError, noteLogged, subscribe, toggleFavorite, watchFavorites } from "../sync/memberData";
import { useLibrary } from "./useLibrary";

const NONE: Favorite[] = [];

/**
 * The current Member's Favorite Library ids, for search ranking (ticket 13). Empty until loaded.
 * The Set is the same object until the Favorites change, so it can sit in a useMemo dependency.
 */
export function useFavoriteIds(): ReadonlySet<string> {
  const favorites = useSyncExternalStore(subscribe, currentFavorites) ?? NONE;
  useEffect(watchFavorites, []);
  return useMemo(() => new Set(favorites.map((f) => f.libraryId)), [favorites]);
}

/** Favorites, Quick Add (the starred Library Foods and Recipes, most recently used first) and the actions on them. */
export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, currentFavorites);
  const error = useSyncExternalStore(subscribe, favoritesError);
  const { items: library } = useLibrary();
  useEffect(watchFavorites, []);
  const ids = useMemo(() => new Set((favorites ?? NONE).map((f) => f.libraryId)), [favorites]);
  const items: LibraryItem[] = useMemo(() => quickAdd(favorites ?? NONE, library), [favorites, library]);
  return {
    /** False until the Favorites first load (stars stay hidden so a tap can't race the load). */
    loaded: favorites !== undefined,
    error,
    isFavorite: (libraryId: string) => ids.has(libraryId),
    /** Star or unstar a Library item. */
    toggle: toggleFavorite,
    quickAdd: items,
    /** Call after logging Entries: starred items among them move to the top of Quick Add. */
    noteLogged,
  };
}

export { noteLogged, forgetFavorite } from "../sync/memberData";
