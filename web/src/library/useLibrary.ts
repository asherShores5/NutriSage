// The Library as every screen sees it (add box, search, Quick Add, Library edit). Loaded once per
// app session and kept in memory, like useGoals; a Guest gets their own device Library, never the
// household's. Screens that save a Food (an estimate, a Library edit) call rememberFood / forgetFood
// so every screen updates without a refetch.
import { useEffect, useSyncExternalStore } from "react";
import type { Food } from "@nutrisage/shared";
import { getLibrary } from "../api/library";
import { currentUsername } from "../auth";
import { isGuest } from "../session";

let foods: Food[] | undefined;
let loading: Promise<void> | undefined;
let error: string | undefined;
/** Whose Library is cached: a Guest's or the household's (per signed-in Member, so sign-out drops it). */
let owner: string | undefined;
const whoNow = () => (isGuest() ? "guest" : `member:${currentUsername() ?? ""}`);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function resetIfOwnerChanged() {
  if (owner === whoNow()) return;
  owner = whoNow();
  foods = undefined;
  loading = undefined;
  error = undefined;
}

function load(force = false) {
  resetIfOwnerChanged();
  if (force) loading = undefined;
  const forWhom = owner;
  loading ??= getLibrary().then(
    (list) => { if (owner !== forWhom) return; foods = list; error = undefined; emit(); },
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

/** The Library's Foods (empty until loaded), any load error, and a way to refetch. */
export function useLibrary() {
  const current = useSyncExternalStore(subscribe, () => foods);
  const loadError = useSyncExternalStore(subscribe, () => error);
  useEffect(() => load(), []);
  return { foods: current ?? EMPTY, loaded: current !== undefined, error: loadError, reload: () => load(true) };
}

const EMPTY: Food[] = [];
