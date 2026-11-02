import { useState } from "react";
import { MEALS, MEAL_LABELS, NUTRIENTS, type Entry, type Meal } from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { blankNutrientValues, entryFromEstimate, readEntryForm } from "./entryForm";

/** "ValidationError: Type a Food" -> "Type a Food": the API's error type isn't for people. */
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^(ValidationError|Unavailable): /, "");

/**
 * Type a Food into a Meal. Enter (or Estimate) asks Bedrock for one serving's nutrition and logs it;
 * "Type nutrition by hand" switches to typing the numbers yourself.
 */
export function EntryForm({ onAdd }: { onAdd: (entry: Omit<Entry, "id">) => void }) {
  const [name, setName] = useState("");
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [byHand, setByHand] = useState(false);
  const [values, setValues] = useState(blankNutrientValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (byHand) {
      const r = readEntryForm({ name, meal, values });
      if (!r.ok) return setError(r.error);
      setError(undefined);
      onAdd(r.entry);
      setName("");
      setValues(blankNutrientValues());
      return;
    }
    if (!name.trim()) return setError("Type a Food to estimate");
    setBusy(true);
    setError(undefined);
    try {
      onAdd(entryFromEstimate(await estimate(name), meal));
      setName("");
    } catch (err) {
      setError(plain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={submit} aria-label="Add an Entry" aria-busy={busy}>
      <div className="entry-form-row">
        <input aria-label="Food" placeholder={byHand ? "What did you eat?" : "e.g. 2 eggs scrambled"} value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </div>
      {byHand && (
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
      )}
      <div className="entry-form-actions">
        <button className="primary" disabled={busy}>{byHand ? "Add Entry" : busy ? "Estimating…" : "Estimate"}</button>
        <button type="button" className="link" onClick={() => { setByHand(!byHand); setError(undefined); }}>
          {byHand ? "Estimate instead" : "Type nutrition by hand"}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
