import { useState } from "react";
import {
  MEALS, MEAL_LABELS, entryAmount, entryUnits, formatAmount, isDateKey, parseAmount, rescaleEntry,
  type Entry, type Meal,
} from "@nutrisage/shared";
import { AmountPicker } from "../../components/AmountPicker";

/**
 * Edit one Entry, opened from the Entry list. Ticket 04: delete. Ticket 05: amount and unit, which
 * rescale the snapshot as you type; bad input shows a message and leaves the Entry as it was.
 * Ticket 06: the Meal and Day pickers move it (amount and nutrition snapshot stay as they are).
 */
export function EntryEditor({ entry, date, onChange, onMoveToDay, onDelete, onClose }: {
  entry: Entry;
  /** The Day the Entry is on (YYYY-MM-DD). */
  date: string;
  onChange: (entry: Entry) => void;
  onMoveToDay: (date: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Units with their gram weights, taken when the editor opens, so g -> serving still works after a switch.
  const [units] = useState(() => entryUnits(entry));
  const current = entryAmount(entry);
  const [text, setText] = useState(() => formatAmount(current.amount));
  const [error, setError] = useState<string>();

  function apply(nextText: string, unit: string) {
    setText(nextText);
    const a = parseAmount(nextText, unit);
    if (!a.ok) return setError(a.error);
    const r = rescaleEntry(entry, { amount: a.amount, unit }, units);
    if (!r.ok) return setError(r.error);
    setError(undefined);
    onChange(r.entry);
  }

  /** Switching unit keeps the same food: 1 1/2 serving of a 120 g serving becomes 180 g. */
  function switchUnit(unit: string) {
    const from = units.find((u) => u.label === current.unit)?.grams;
    const to = units.find((u) => u.label === unit)?.grams;
    if (!from || !to) return apply(text, unit);
    const same = (current.amount * from) / to;
    apply(formatAmount(unit === "g" ? Math.max(1, Math.round(same)) : same), unit);
  }

  return (
    <div className="entry-editor" role="group" aria-label={`Edit ${entry.name}`}>
      <AmountPicker amount={text} unit={current.unit} units={units.map((u) => u.label)} onAmount={(t) => apply(t, current.unit)} onUnit={switchUnit} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="entry-move">
        <label>
          <span>Meal</span>
          <select aria-label="Meal" value={entry.meal} onChange={(e) => onChange({ ...entry, meal: e.target.value as Meal })}>
            {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
          </select>
        </label>
        <label>
          <span>Day</span>
          <input type="date" aria-label="Day" value={date} onChange={(e) => isDateKey(e.target.value) && e.target.value !== date && onMoveToDay(e.target.value)} />
        </label>
      </div>
      <div className="entry-editor-actions">
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
