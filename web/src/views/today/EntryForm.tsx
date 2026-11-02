import { useState } from "react";
import { GRAMS, MEALS, MEAL_LABELS, NUTRIENTS, SERVING, parseAmount, type Entry, type Meal } from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { AmountPicker } from "../../components/AmountPicker";
import { useMealPick } from "./useMealPick";
import { blankNutrientValues, entryFromEstimate, readEntryForm } from "./entryForm";

/** "ValidationError: Type a Food" -> "Type a Food": the API's error type isn't for people. */
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^(ValidationError|Unavailable): /, "");

/**
 * Type a Food into a Meal with an amount and unit. Enter (or Estimate) asks Bedrock for one serving's
 * nutrition and logs it scaled to the amount; "Type nutrition by hand" switches to typing one
 * serving's numbers yourself (servings only, since a hand-typed serving has no gram weight).
 */
export function EntryForm({ onAdd }: { onAdd: (entry: Omit<Entry, "id">) => void }) {
  const [name, setName] = useState("");
  const [meal, setMeal] = useMealPick();
  const [byHand, setByHand] = useState(false);
  const [values, setValues] = useState(blankNutrientValues);
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<string>(SERVING);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function resetAmount() {
    setAmount("1");
    setUnit(SERVING);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (byHand) {
      const r = readEntryForm({ name, meal, values, amount });
      if (!r.ok) return setError(r.error);
      setError(undefined);
      onAdd(r.entry);
      setName("");
      setValues(blankNutrientValues());
      resetAmount();
      return;
    }
    if (!name.trim()) return setError("Type a Food to estimate");
    const a = parseAmount(amount, unit);
    if (!a.ok) return setError(a.error);
    setBusy(true);
    setError(undefined);
    try {
      const r = entryFromEstimate(await estimate(name), meal, { amount: a.amount, unit });
      if (!r.ok) return setError(r.error);
      onAdd(r.entry);
      setName("");
      resetAmount();
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
      <AmountPicker amount={amount} unit={unit} units={byHand ? [SERVING] : [SERVING, GRAMS]} onAmount={setAmount} onUnit={setUnit} />
      {byHand && (
        <div className="nutrient-inputs" role="group" aria-label="Nutrition for 1 serving">
          <p className="nutrient-inputs-head">Nutrition for 1 serving</p>
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
        <button type="button" className="link" onClick={() => { setByHand(!byHand); setUnit(SERVING); setError(undefined); }}>
          {byHand ? "Estimate instead" : "Type nutrition by hand"}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
