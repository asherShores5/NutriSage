import { useState } from "react";
import { MEAL_LABELS, entriesByMeal, sumMacros, type Entry, type EntryMove } from "@nutrisage/shared";
import { StarButton } from "../../components/StarButton";
import { useFavorites } from "../../library/useFavorites";
import { useLibrary } from "../../library/useLibrary";
import { EntryEditor } from "./EntryEditor";

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The Day's Entries grouped by Meal, in display order, each Meal with its calories. Tap an Entry to
 * edit it. An Entry logged from a Library item still in the Library has a star to make it a Favorite.
 */
export function EntryList({ date, entries, empty, onChange, onMove, onDelete }: {
  /** The Day shown (YYYY-MM-DD). */
  date: string;
  entries: Entry[];
  /** Shown when the Day has no Entries. */
  empty: string;
  onChange: (entry: Entry) => void;
  /** Move an Entry to another Day (Meal changes on the same Day go through `onChange`). */
  onMove: (id: string, to: EntryMove & { date: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState<string>();
  const favorites = useFavorites();
  const { items } = useLibrary();
  const inLibrary = new Set(items.map((f) => f.id));
  if (!entries.length) return <p className="empty">{empty}</p>;
  return (
    <section className="entry-list" aria-label="Entries">
      {entriesByMeal(entries).map(([meal, list]) => (
        <div key={meal} className="meal-group" role="group" aria-label={MEAL_LABELS[meal]}>
          <div className="meal-head">
            <h3>{MEAL_LABELS[meal]}</h3>
            <span className="meal-cal">{Math.round(sumMacros(list).calories)} cal</span>
          </div>
          <ul>
            {list.map((e) => (
              <li key={e.id} className="entry">
                <button type="button" className="entry-row" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? undefined : e.id)}>
                  <span className="entry-main">
                    <span className="entry-name">
                      {e.name}
                      {e.grams ? <span className="entry-grams">{Math.round(e.grams)} g</span> : null}
                    </span>
                    <span className="entry-macros">
                      {r1(e.nutrition.carbs)}c / {r1(e.nutrition.protein)}p / {r1(e.nutrition.fat)}f · {r1(e.nutrition.fiber)}g fiber · Na {r1(e.nutrition.sodium)}mg · Fe {r1(e.nutrition.iron)}mg
                    </span>
                  </span>
                  <span className="entry-cal">{Math.round(e.nutrition.calories)} cal</span>
                </button>
                {favorites.loaded && e.libraryId && inLibrary.has(e.libraryId) && (
                  <StarButton name={e.name} starred={favorites.isFavorite(e.libraryId)} onToggle={() => favorites.toggle(e.libraryId!)} />
                )}
                {open === e.id && (
                  <EntryEditor
                    entry={e}
                    date={date}
                    onChange={onChange}
                    onMoveToDay={(date) => { setOpen(undefined); onMove(e.id, { date }); }}
                    onDelete={() => { setOpen(undefined); onDelete(e.id); }}
                    onClose={() => setOpen(undefined)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
