// The Member's Days from `from` to `to` (inclusive), read once per mount for Week and Trends.
// Each tab remounts when shown, so it picks up what Today just logged. Ticket 09 may swap the
// fetch for the local copy; the screens keep using this hook.
import { useEffect, useState } from "react";
import { daysByDate, type Day } from "@nutrisage/shared";
import { getDays } from "../../api/days";

export function useDays(from: string, to: string) {
  const [days, setDays] = useState<Record<string, Day>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setDays(undefined);
    getDays(from, to).then(
      (list) => live && setDays(daysByDate(list)),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [from, to]);
  return { days, error };
}
