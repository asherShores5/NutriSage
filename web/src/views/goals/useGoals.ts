// The Member's goals, shared by Today (bars, water) and the Goals tab. Loaded once per app session
// and kept in memory, so switching tabs doesn't refetch; saving updates every screen.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Goals } from "@nutrisage/shared";
import { getGoals, putGoals } from "../../api/goals";
import { currentUsername } from "../../auth";
import { isGuest } from "../../session";

let goals: Goals | undefined;
let loading: Promise<void> | undefined;
let error: string | undefined;
/** Whose goals are cached: a Guest's or a Member's. Leaving Guest mode or signing out must not show the last person's. */
let owner: string | undefined;
const whoNow = () => (isGuest() ? "guest" : `member:${currentUsername() ?? ""}`);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function load() {
  if (owner !== whoNow()) {
    owner = whoNow();
    goals = undefined;
    loading = undefined;
    error = undefined;
  }
  const forWhom = owner;
  loading ??= getGoals().then(
    (g) => { if (owner !== forWhom) return; goals = g; error = undefined; emit(); },
    (e) => { if (owner !== forWhom) return; error = (e as Error).message; loading = undefined; emit(); },
  );
}

export function useGoals() {
  const current = useSyncExternalStore(subscribe, () => goals);
  const loadError = useSyncExternalStore(subscribe, () => error);
  useEffect(load, []);
  /** Save new goals; resolves when stored, throws on failure (the screen shows the message). */
  const save = useCallback(async (next: Goals) => {
    goals = await putGoals(next);
    emit();
  }, []);
  return { goals: current, error: loadError, save };
}
