// The Member's Meal windows, shared by Today (the Meal picker's guess) and the Profile card. Loaded
// once per app session and kept in memory, like useGoals; saving updates every screen.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { MealWindows } from "@nutrisage/shared";
import { getMealWindows, putMealWindows } from "../../api/mealWindows";

let windows: MealWindows | undefined;
let loading: Promise<void> | undefined;
let error: string | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function load() {
  loading ??= getMealWindows().then(
    (w) => { windows = w; error = undefined; emit(); },
    (e) => { error = (e as Error).message; loading = undefined; emit(); },
  );
}

/** `windows` is undefined until loaded (Today uses the defaults meanwhile). */
export function useMealWindows() {
  const current = useSyncExternalStore(subscribe, () => windows);
  const loadError = useSyncExternalStore(subscribe, () => error);
  useEffect(load, []);
  /** Save new windows; resolves when stored, throws on failure (the card shows the message). */
  const save = useCallback(async (next: MealWindows) => {
    windows = await putMealWindows(next);
    emit();
  }, []);
  return { windows: current, error: loadError, save };
}
