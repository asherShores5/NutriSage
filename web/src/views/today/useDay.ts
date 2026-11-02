// One Day for a screen. Reads and writes go through the Member's local copy (sync/memberData.ts):
// the Day on this device shows at once, each change is saved on the device and queued in the
// outbox (whole Day: Entries, water and weight together, last write wins per Day), and the
// server copy loads in the background and again whenever the app comes back to the front.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Day } from "@nutrisage/shared";
import { dayError, getDay, saveDay, subscribe, watchDay } from "../../sync/memberData";

export function useDay(date: string) {
  const day = useSyncExternalStore(subscribe, () => getDay(date));
  const error = useSyncExternalStore(subscribe, () => dayError(date));
  useEffect(() => watchDay(date), [date]);

  /** Apply a change now and queue the whole Day. If the API refuses it, the error shows and the Day reloads. */
  const update = useCallback(
    (change: (d: Day) => Day) => {
      const current = getDay(date);
      if (current) saveDay(change(current));
    },
    [date],
  );

  return { day, error, update };
}
