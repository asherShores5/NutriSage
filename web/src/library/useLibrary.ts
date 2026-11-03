// The Library as every screen sees it (add box, search, Quick Add, Library edit). Loaded once per
// app session and kept in memory, like useGoals; a Guest gets their own device Library, never the
// household's. Screens that save a Food (an estimate, a Library edit) call rememberFood / forgetFood,
// and the Recipe builder and Library edit call rememberRecipe / forgetRecipe (ticket 19), so every
// screen updates without a refetch. `items` is Foods and Recipes together, for search and Quick Add.
import { useEffect, useSyncExternalStore } from "react";
import type { Food, LibraryItem, Recipe } from "@nutrisage/shared";
import { getLibrary } from "../api/library";
import { getRecipes } from "../api/recipes";
import { currentUsername } from "../auth";
import { isGuest } from "../session";

let foods: Food[] | undefined;
let recipes: Recipe[] | undefined;
/** Foods then Recipes, rebuilt only when either changes (a stable snapshot for useSyncExternalStore). */
let items: LibraryItem[] | undefined;
let loading: Promise<void> | undefined;
let error: string | undefined;
/** Whose Library is cached: a Guest's or the household's (per signed-in Member, so sign-out drops it). */
let owner: string | undefined;
const whoNow = () => (isGuest() ? "guest" : `member:${currentUsername() ?? ""}`);
const listeners = new Set<() => void>();
function emit() {
  items = foods && recipes ? [...foods, ...recipes] : undefined;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function resetIfOwnerChanged() {
  if (owner === whoNow()) return;
  owner = whoNow();
  foods = undefined;
  recipes = undefined;
  items = undefined;
  loading = undefined;
  error = undefined;
}

function load(force = false) {
  resetIfOwnerChanged();
  if (force) loading = undefined;
  const forWhom = owner;
  loading ??= Promise.all([getLibrary(), getRecipes()]).then(
    ([f, r]) => { if (owner !== forWhom) return; foods = f; recipes = r; error = undefined; emit(); },
    (e) => { if (owner !== forWhom) return; error = (e as Error).message; loading = undefined; emit(); },
  );
}

/** Add or replace (by id) one Food in the cached Library. */
export function rememberFood(food: Food) {
  resetIfOwnerChanged();
  if (!foods) return load(true);
  foods = [...foods.filter((f) => f.id !== food.id), food];
  emit();
}

/** Drop one Food from the cached Library (after a delete). */
export function forgetFood(id: string) {
  if (!foods) return;
  foods = foods.filter((f) => f.id !== id);
  emit();
}

/** Add or replace (by id) one Recipe in the cached Recipe Book. */
export function rememberRecipe(recipe: Recipe) {
  resetIfOwnerChanged();
  if (!recipes) return load(true);
  recipes = [...recipes.filter((r) => r.id !== recipe.id), recipe];
  emit();
}

/** Drop one Recipe from the cached Recipe Book (after a delete). */
export function forgetRecipe(id: string) {
  if (!recipes) return;
  recipes = recipes.filter((r) => r.id !== id);
  emit();
}

/** The Library's Foods, Recipes and both together (empty until loaded), any load error, and a way to refetch. */
export function useLibrary() {
  const all = useSyncExternalStore(subscribe, () => items);
  const loadError = useSyncExternalStore(subscribe, () => error);
  useEffect(() => load(), []);
  return {
    foods: (all && foods) || EMPTY_FOODS,
    recipes: (all && recipes) || EMPTY_RECIPES,
    items: all ?? EMPTY_ITEMS,
    loaded: all !== undefined,
    error: loadError,
    reload: () => load(true),
  };
}

const EMPTY_FOODS: Food[] = [];
const EMPTY_RECIPES: Recipe[] = [];
const EMPTY_ITEMS: LibraryItem[] = [];
