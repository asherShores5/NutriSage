import { MEALS, MEAL_LABELS, isDateKey, type Entry, type Meal } from "@nutrisage/shared";

/**
 * Edit one Entry, opened from the Entry list. Ticket 04: delete. Ticket 06: the Meal and Day
 * pickers move it (amount and nutrition snapshot stay as they are). Amount and unit (05) add their
 * controls here and save through `onChange`.
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
  return (
    <div className="entry-editor" role="group" aria-label={`Edit ${entry.name}`}>
      {/* 06: move to another Meal or Day */}
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
