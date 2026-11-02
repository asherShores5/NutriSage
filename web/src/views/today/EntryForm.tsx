import { useState } from "react";
import { MEALS, MEAL_LABELS, NUTRIENTS, SERVING, findFoodByName, logFood, parseAmount, type Entry, type Meal } from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { AmountPicker } from "../../components/AmountPicker";
import { rememberFood, useLibrary } from "../../library/useLibrary";
import { useMealPick } from "./useMealPick";
import { blankNutrientValues, entryFromEstimate, formUnits, readEntryForm } from "./entryForm";

/** "ValidationError: Type a Food" -> "Type a Food": the API's error type isn't for people. */
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^(ValidationError|Unavailable): /, "");

/**
 * Type a Food into a Meal with an amount and unit. A name already in the Library logs from that
 * Food in any of its units (no Bedrock call); otherwise Enter (or Estimate) asks Bedrock for one
 * serving's nutrition, saves it to the Library and logs it scaled to the amount. "Type nutrition by
 * hand" switches to typing one serving's numbers yourself (servings only, no gram weight).
 * Ticket 13 replaces the exact-name match (and the name suggestions) with live fuzzy search.
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
  const { foods } = useLibrary();
  const known = byHand ? undefined : findFoodByName(foods, name);
  const units = formUnits(foods, name, byHand);
  /** The picked unit, or serving when the typed name no longer offers it. */
  const shownUnit = units.includes(unit) ? unit : SERVING;

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
    const a = parseAmount(amount, shownUnit);
    if (!a.ok) return setError(a.error);
    if (known) {
      const r = logFood(known, { amount: a.amount, unit: shownUnit }, meal);
      if (!r.ok) return setError(r.error);
      setError(undefined);
      onAdd(r.entry);
      setName("");
      resetAmount();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const est = await estimate(name);
      if (est.food) rememberFood(est.food);
      const r = entryFromEstimate(est, meal, { amount: a.amount, unit: shownUnit });
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
        <input
          aria-label="Food"
          placeholder={byHand ? "What did you eat?" : "e.g. 2 eggs scrambled"}
          value={name}
          list={byHand ? undefined : "library-foods"}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        {!byHand && (
          <datalist id="library-foods">
            {foods.map((f) => <option key={f.id} value={f.name} />)}
          </datalist>
        )}
        <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </div>
      <AmountPicker amount={amount} unit={shownUnit} units={units} onAmount={setAmount} onUnit={setUnit} />
      {known && <p className="entry-form-known" role="status">In the Library: logs from {known.name}</p>}
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
        <button className="primary" disabled={busy}>{byHand || known ? "Add Entry" : busy ? "Estimating…" : "Estimate"}</button>
        <button type="button" className="link" onClick={() => { setByHand(!byHand); setUnit(SERVING); setError(undefined); }}>
          {byHand ? "Estimate instead" : "Type nutrition by hand"}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
