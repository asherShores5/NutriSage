import { MEAL_LABELS, entriesByMeal, type Entry } from "@nutrisage/shared";

/** The Day's Entries grouped by Meal, in display order. */
export function EntryList({ entries }: { entries: Entry[] }) {
  if (!entries.length) return <p className="empty">Nothing logged yet today.</p>;
  return (
    <section className="entry-list" aria-label="Entries">
      {entriesByMeal(entries).map(([meal, list]) => (
        <div key={meal} className="meal-group">
          <h3>{MEAL_LABELS[meal]}</h3>
          <ul>
            {list.map((e) => (
              <li key={e.id} className="entry">
                <span className="entry-name">
                  {e.name}
                  {e.grams ? <span className="entry-grams">{Math.round(e.grams)} g</span> : null}
                </span>
                <span className="entry-cal">{Math.round(e.nutrition.calories)} cal</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
