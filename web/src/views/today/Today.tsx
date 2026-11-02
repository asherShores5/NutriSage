import { dateKey } from "@nutrisage/shared";
import { EntryForm } from "./EntryForm";
import { EntryList } from "./EntryList";
import { Totals } from "./Totals";
import { useDay } from "./useDay";
import "./today.css";

/** Today: totals, the Entry form and the Entry list for the Member's current local date. */
export function Today() {
  const date = dateKey(new Date());
  const { day, error, update } = useDay(date);

  return (
    <div className="today">
      <h2>Today</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!day ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <Totals entries={day.entries} />
          <EntryForm onAdd={(entry) => update((d) => ({ ...d, entries: [...d.entries, { id: crypto.randomUUID(), ...entry }] }))} />
          <EntryList entries={day.entries} />
        </>
      )}
    </div>
  );
}
