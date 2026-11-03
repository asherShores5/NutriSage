import { useState } from "react";
import { MEAL_LABELS, SERVING, isRecipe, logLibraryItem, type Entry, type LibraryItem } from "@nutrisage/shared";
import { useFavorites } from "../../library/useFavorites";
import { useMealPick } from "./useMealPick";

/**
 * Quick Add: the Member's Favorites, most recently used first. A tap logs one serving of a Food, or
 * 1/4 of the batch of a Recipe (QUICK_ADD_PORTION, ticket 19), into the current Meal (the add box's);
 * the amount can be changed on the Entry afterwards. Logging moves
 * the item to the front (Today calls noteLogged for every add).
 */
export function QuickAdd({ onAdd }: { onAdd: (entry: Omit<Entry, "id">) => void }) {
  const { loaded, quickAdd, error } = useFavorites();
  const [meal] = useMealPick();
  const [logError, setLogError] = useState<string>();
  if (!loaded) return null;

  function add(item: LibraryItem) {
    const r = logLibraryItem(item, { amount: 1, unit: SERVING }, meal);
    if (!r.ok) return setLogError(r.error);
    setLogError(undefined);
    onAdd(r.entry);
  }

  return (
    <section className="quick-add" aria-label="Quick Add">
      <div className="quick-add-head">
        <h3>Quick Add</h3>
        {quickAdd.length > 0 && (
          <span className="quick-add-meal">
            1 serving{quickAdd.some(isRecipe) ? " (Recipes 1/4 batch)" : ""} to {MEAL_LABELS[meal]}
          </span>
        )}
      </div>
      {quickAdd.length === 0 ? (
        <p className="quick-add-empty">Star a Food or Recipe (☆) to keep it here.</p>
      ) : (
        <ul>
          {quickAdd.map((f) => (
            <li key={f.id}>
              <button type="button" className="quick-add-item" aria-label={`Add ${f.name}`} onClick={() => add(f)}>
                {f.name}
                {isRecipe(f) && <small className="item-kind"> Recipe</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(logError ?? error) && <p className="error" role="alert">{logError ?? error}</p>}
    </section>
  );
}
