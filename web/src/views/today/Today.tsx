import { DEFAULT_WATER_GOAL, dateKey, sumMacros, type Entry } from "@nutrisage/shared";
import { Bars } from "../../components/Bars";
import { useGoals } from "../goals/useGoals";
import { EntryForm } from "./EntryForm";
import { EntryList } from "./EntryList";
import { Water } from "./Water";
import { Weight } from "./Weight";
import { useDay } from "./useDay";
import "./today.css";

/** Today: progress bars, the add box, Entries by Meal, water and weight for the Member's current local date. */
export function Today() {
  const date = dateKey(new Date());
  const { day, error, update } = useDay(date);
  const { goals } = useGoals();

  const setEntries = (change: (entries: Entry[]) => Entry[]) => update((d) => ({ ...d, entries: change(d.entries) }));

  return (
    <div className="today">
      <h2>Today</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!day ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <Bars totals={sumMacros(day.entries)} goals={goals} />
          <EntryForm onAdd={(entry) => setEntries((list) => [...list, { id: crypto.randomUUID(), ...entry }])} />
          <EntryList
            entries={day.entries}
            onChange={(entry) => setEntries((list) => list.map((e) => (e.id === entry.id ? entry : e)))}
            onDelete={(id) => setEntries((list) => list.filter((e) => e.id !== id))}
          />
          <Water cups={day.water ?? 0} goal={goals?.water ?? DEFAULT_WATER_GOAL} onChange={(water) => update((d) => ({ ...d, water }))} />
          <Weight weight={day.weight ?? null} onChange={(weight) => update((d) => ({ ...d, weight }))} />
        </>
      )}
    </div>
  );
}
