// Favorites and Quick Add (GLOSSARY.md; spec: Domain model > Favorites and Quick Add).
// A Favorite is one Member's star on a Library item plus when they last logged it. Quick Add is
// that Member's Favorites, most recently used first.

/** One Member's star on a Library item (Food or Recipe). */
export interface Favorite {
  libraryId: string;
  /** Epoch ms the Member last logged it (or starred it, if never logged since). */
  lastUsed: number;
}

/**
 * The Library items in Quick Add: the starred ones, most recently used first. A Favorite whose
 * item is no longer in the Library (deleted, or not loaded yet) is left out.
 */
export function quickAdd<T extends { id: string }>(favorites: readonly Favorite[], library: readonly T[]): T[] {
  const byId = new Map(library.map((i) => [i.id, i]));
  return [...favorites]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .flatMap((f) => {
      const i = byId.get(f.libraryId);
      return i ? [i] : [];
    });
}

/**
 * Logging `libraryIds` at time `at` (from Quick Add, search, a Recipe...): every starred one gets
 * `lastUsed = at`, so it moves to the top of Quick Add. Unstarred items (and Entries with no
 * Library item) change nothing, and a last-used time never moves backwards. `bumped` is the
 * Favorites that changed, to save.
 */
export function bumpFavorites(
  favorites: readonly Favorite[],
  libraryIds: readonly (string | null | undefined)[],
  at: number,
): { favorites: Favorite[]; bumped: Favorite[] } {
  const logged = new Set(libraryIds.filter((id): id is string => !!id));
  const bumped: Favorite[] = [];
  const next = favorites.map((f) => {
    if (!logged.has(f.libraryId) || f.lastUsed >= at) return f;
    const b = { ...f, lastUsed: at };
    bumped.push(b);
    return b;
  });
  return { favorites: next, bumped };
}

/** A change to save for one Favorite. */
export type FavoriteChange = { type: "put"; favorite: Favorite } | { type: "delete"; libraryId: string };

/** Star an unstarred item (it goes to the top of Quick Add) or unstar a starred one. */
export function toggleFavorite(favorites: readonly Favorite[], libraryId: string, at: number): { favorites: Favorite[]; change: FavoriteChange } {
  if (favorites.some((f) => f.libraryId === libraryId)) {
    return { favorites: favorites.filter((f) => f.libraryId !== libraryId), change: { type: "delete", libraryId } };
  }
  const favorite = { libraryId, lastUsed: at };
  return { favorites: [...favorites, favorite], change: { type: "put", favorite } };
}
