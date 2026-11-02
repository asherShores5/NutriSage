// One Day, loaded from the API and written back whole after each change (Entries, water and
// weight together: last write wins per Day). Writes go out one at a time in order, so quick taps
// (e.g. water cups) can't land out of order. Ticket 09 replaces the direct writes with a local
// copy + outbox for offline use; screens keep using this hook.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Day } from "@nutrisage/shared";
import { getDays, putDay } from "../../api/days";

export function useDay(date: string) {
  const [day, setDay] = useState<Day>();
  const [error, setError] = useState<string>();
  const latest = useRef<Day>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    latest.current = undefined;
    setDay(undefined);
    getDays(date, date).then(
      ([d]) => {
        if (!live) return;
        latest.current = d ?? { date, entries: [], water: null, weight: null };
        setDay(latest.current);
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [date]);

  /** Apply a change now and save the whole Day. On failure the error shows and the change stays on screen. */
  const update = useCallback((change: (d: Day) => Day) => {
    if (!latest.current) return;
    const next = change(latest.current);
    latest.current = next;
    setDay(next);
    setError(undefined);
    queue.current = queue.current.then(() => putDay(next).then(() => {}, (e) => setError((e as Error).message)));
  }, []);

  return { day, error, update };
}
