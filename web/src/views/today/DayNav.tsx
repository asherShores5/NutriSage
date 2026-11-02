import { dayLabel, isDateKey, shiftDate } from "@nutrisage/shared";

/**
 * The Today header: which Day is shown, arrows to the previous and next Day, and tap the title to
 * pick any date (the native date picker sits invisibly over it). Away from today, "Back to today" returns.
 */
export function DayNav({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  return (
    <div className="day-nav" role="group" aria-label="Day">
      <button type="button" className="day-step" aria-label="Previous Day" onClick={() => onChange(shiftDate(date, -1))}>‹</button>
      <label className="day-pick">
        <h2>{dayLabel(date, today)}</h2>
        <input type="date" aria-label="Pick a Day" value={date} onChange={(e) => isDateKey(e.target.value) && onChange(e.target.value)} />
      </label>
      <button type="button" className="day-step" aria-label="Next Day" onClick={() => onChange(shiftDate(date, 1))}>›</button>
      {date !== today && <button type="button" className="link day-today" onClick={() => onChange(today)}>Back to today</button>}
    </div>
  );
}
