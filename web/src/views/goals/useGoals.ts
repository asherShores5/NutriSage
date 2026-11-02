// The Member's goals, shared by Today (bars, water) and the Goals tab. Kept in the Member's local
// copy (sync/memberData.ts), so they show offline and saving updates every screen at once.
import { useEffect, useSyncExternalStore } from "react";
import { currentGoals, goalsError, saveGoals, subscribe, watchGoals } from "../../sync/memberData";

export function useGoals() {
  const goals = useSyncExternalStore(subscribe, currentGoals);
  const error = useSyncExternalStore(subscribe, goalsError);
  useEffect(watchGoals, []);
  /** Save new goals; resolves when stored or queued offline, throws if the API refused them. */
  return { goals, error, save: saveGoals };
}
