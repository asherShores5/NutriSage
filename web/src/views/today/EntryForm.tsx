import { useState } from "react";
import { MEALS, MEAL_LABELS, NUTRIENTS, type Entry, type Meal } from "@nutrisage/shared";
import { blankNutrientValues, readEntryForm } from "./entryForm";

/** Type an Entry's name and nutrition by hand into a Meal. Ticket 02 adds Bedrock estimates. */
export function EntryForm({ onAdd }: { onAdd: (entry: Omit<Entry, "id">) => void }) {
  const [name, setName] = useState("");
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [values, setValues] = useState(blankNutrientValues);
  const [error, setError] = useState<string>();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = readEntryForm({ name, meal, values });
    if (!r.ok) return setError(r.error);
    setError(undefined);
    onAdd(r.entry);
    setName("");
    setValues(blankNutrientValues());
  }

  return (
    <form className="entry-form" onSubmit={submit} aria-label="Add an Entry">
      <div className="entry-form-row">
        <input aria-label="Food" placeholder="What did you eat?" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </div>
      <div className="nutrient-inputs">
        {NUTRIENTS.map((n) => (
          <label key={n.key}>
            <span>{n.label} <small>{n.unit}</small></span>
            <input
              inputMode="decimal"
              aria-label={n.label}
              value={values[n.key]}
              onChange={(e) => setValues({ ...values, [n.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <button className="primary">Add Entry</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
