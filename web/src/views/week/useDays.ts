// The Member's Days from `from` to `to` (inclusive), read once per mount for Week and Trends.
// Each tab remounts when shown, so it picks up what Today just logged. Reads go through the local
// copy (sync/memberData.ts): Days still waiting to sync count, and offline it shows the Days kept
// on this device.
import { useEffect, useState } from "react";
import type { Day } from "@nutrisage/shared";
import { loadDays } from "../../sync/memberData";

export function useDays(from: string, to: string) {
  const [days, setDays] = useState<Record<string, Day>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setDays(undefined);
    loadDays(from, to).then(
      (byDate) => live && setDays(byDate),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [from, to]);
  return { days, error };
}
