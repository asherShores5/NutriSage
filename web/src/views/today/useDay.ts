// One Day, loaded from the API and written back whole after each change. Ticket 09 replaces the
// direct writes with a local copy + outbox for offline use; screens keep using this hook.
import { useCallback, useEffect, useState } from "react";
import type { Day } from "@nutrisage/shared";
import { getDays, putDay } from "../../api/days";

export function useDay(date: string) {
  const [day, setDay] = useState<Day>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    setDay(undefined);
    getDays(date, date).then(
      ([d]) => live && setDay(d ?? { date, entries: [] }),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [date]);

  /** Apply a change now and save the whole Day. On failure the error shows and the change stays on screen. */
  const update = useCallback(
    async (change: (d: Day) => Day) => {
      if (!day) return;
      const next = change(day);
      setDay(next);
      setError(undefined);
      try {
        await putDay(next);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [day],
  );

  return { day, error, update };
}
