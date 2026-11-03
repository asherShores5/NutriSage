// The Member's Meal windows, shared by Today (the Meal picker's guess) and the Profile card. Kept in
// the Member's local copy (sync/memberData.ts), like useGoals: they show offline, a change is queued
// in the outbox, they reload on focus, and saving updates every screen at once.
import { useEffect, useSyncExternalStore } from "react";
import { currentMealWindows, mealWindowsError, saveMealWindows, subscribe, watchMealWindows } from "../../sync/memberData";

/** `windows` is undefined until loaded (Today uses the defaults meanwhile). */
export function useMealWindows() {
  const windows = useSyncExternalStore(subscribe, currentMealWindows);
  const error = useSyncExternalStore(subscribe, mealWindowsError);
  useEffect(watchMealWindows, []);
  /** Save new windows; resolves when stored or queued offline, throws if the API refused them (the card shows the message). */
  return { windows, error, save: saveMealWindows };
}
