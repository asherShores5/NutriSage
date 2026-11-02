// The Member's goals, shared by Today (bars, water) and the Goals tab. Loaded once per app session
// and kept in memory, so switching tabs doesn't refetch; saving updates every screen.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Goals } from "@nutrisage/shared";
import { getGoals, putGoals } from "../../api/goals";

let goals: Goals | undefined;
let loading: Promise<void> | undefined;
let error: string | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function load() {
  loading ??= getGoals().then(
    (g) => { goals = g; error = undefined; emit(); },
    (e) => { error = (e as Error).message; loading = undefined; emit(); },
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
