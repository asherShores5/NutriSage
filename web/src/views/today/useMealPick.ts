// The add box's Meal: guessed from the Member's Meal windows (mealPick.ts), overridden by a pick.
// Shared by everything that logs into "the current Meal" (the add box, Quick Add): a pick in one
// shows in all.
import { useEffect, useReducer } from "react";
import { DEFAULT_MEAL_WINDOWS, type Meal } from "@nutrisage/shared";
import { useMealWindows } from "../profile/useMealWindows";
import { mealPickSession } from "./mealPick";

/** One session per app open: switching tabs keeps the guess and any pick. */
const session = mealPickSession(new Date());

/** How often to look for a date rollover while the app stays open. */
const ROLLOVER_CHECK_MS = 60_000;
const listeners = new Set<() => void>();

export function useMealPick(): [Meal, (meal: Meal) => void] {
  const { windows } = useMealWindows();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    const t = setInterval(rerender, ROLLOVER_CHECK_MS);
    const onShow = () => document.visibilityState === "visible" && rerender();
    document.addEventListener("visibilitychange", onShow);
    return () => { listeners.delete(rerender); clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, []);
  const meal = session.current(windows ?? DEFAULT_MEAL_WINDOWS, new Date());
  return [meal, (m) => { session.pick(m); listeners.forEach((l) => l()); }];
}
