import { useState } from "react";
import { DEFAULT_WATER_GOAL, dateKey, moveEntry, sumMacros, type Entry, type EntryMove } from "@nutrisage/shared";
import { Bars } from "../../components/Bars";
import { noteLogged } from "../../library/useFavorites";
import { readDay, saveDay } from "../../sync/memberData";
import { useGoals } from "../goals/useGoals";
import { DayNav } from "./DayNav";
import { EntryForm } from "./EntryForm";
import { EntryList } from "./EntryList";
import { QuickAdd } from "./QuickAdd";
import { Water } from "./Water";
import { Weight } from "./Weight";
import { useDay } from "./useDay";
import "./today.css";

/** Today: one Day (the Member's current local date unless they step to another): progress bars, Quick Add, the add box, Entries by Meal, water and weight. */
export function Today() {
  const today = dateKey(new Date());
  const [date, setDate] = useState(today);
  const { day, error, update } = useDay(date);
  const { goals } = useGoals();
  const [moveError, setMoveError] = useState<string>();
  const isToday = date === today;

  const setEntries = (change: (entries: Entry[]) => Entry[]) => update((d) => ({ ...d, entries: change(d.entries) }));

  /** Every new Entry (add box, Quick Add) comes through here: a starred item moves to the top of Quick Add. */
  function addEntry(entry: Omit<Entry, "id">) {
    setEntries((list) => [...list, { id: crypto.randomUUID(), ...entry }]);
    noteLogged([entry.libraryId]);
  }

  /**
   * Move an Entry to another Day (and maybe Meal). The destination Day is written first, then this
   * Day: a failure in between leaves the Entry on both Days rather than on neither.
   * Both writes go through the outbox in that order, so a move made offline lands the same way.
   */
  async function moveToDay(id: string, to: EntryMove & { date: string }) {
    if (!day) return;
    setMoveError(undefined);
    try {
      const target = await readDay(to.date);
      const writes = moveEntry(day, id, to, target);
      if (writes.length < 2) return;
      saveDay(writes[1]);
      update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
    } catch (e) {
      setMoveError((e as Error).message);
    }
  }

  function clearDay() {
    if (!day?.entries.length) return;
    if (!confirm(`Clear every Entry on ${isToday ? "today" : date}? This can't be undone.`)) return;
    setEntries(() => []);
  }

  return (
    <div className="today">
      <DayNav date={date} today={today} onChange={setDate} />
      {(error || moveError) && <p className="error" role="alert">{error ?? moveError}</p>}
      {!day ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <Bars totals={sumMacros(day.entries)} goals={goals} />
          <QuickAdd onAdd={addEntry} />
          <EntryForm onAdd={addEntry} />
          <EntryList
            key={date}
            date={date}
            entries={day.entries}
            empty={isToday ? "Nothing logged yet today." : "Nothing logged yet."}
            onChange={(entry) => setEntries((list) => list.map((e) => (e.id === entry.id ? entry : e)))}
            onMove={(id, to) => moveToDay(id, to)}
            onDelete={(id) => setEntries((list) => list.filter((e) => e.id !== id))}
          />
          {day.entries.length > 0 && (
            <div className="clear-day">
              <button type="button" className="danger" onClick={clearDay}>Clear day</button>
            </div>
          )}
          <Water cups={day.water ?? 0} goal={goals?.water ?? DEFAULT_WATER_GOAL} onChange={(water) => update((d) => ({ ...d, water }))} />
          <Weight weight={day.weight ?? null} onChange={(weight) => update((d) => ({ ...d, weight }))} />
        </>
      )}
    </div>
  );
}
