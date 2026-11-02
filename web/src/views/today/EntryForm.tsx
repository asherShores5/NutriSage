import { useId, useMemo, useState } from "react";
import { MEALS, MEAL_LABELS, NUTRIENTS, SERVING, logFood, parseAmount, searchLibrary, type Entry, type Food, type Meal } from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { AmountPicker } from "../../components/AmountPicker";
import { rememberFood, useLibrary } from "../../library/useLibrary";
import { RecipeBuilder } from "./RecipeBuilder";
import { useMealPick } from "./useMealPick";
import { blankNutrientValues, entryFromEstimate, formUnits, readEntryForm } from "./entryForm";

/** "ValidationError: Type a Food" -> "Type a Food": the API's error type isn't for people. */
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^(ValidationError|Unavailable): /, "");

/**
 * Type a Food into a Meal with an amount and unit. Typing shows live fuzzy matches from the Library
 * (ticket 13; a Guest's own device Library): tapping one logs it at the amount, in the picked unit
 * when it has it, else servings (no Bedrock call). The match whose whole name was typed, or one
 * chosen with the arrow keys, is "picked": the unit picker offers its units and Enter logs it.
 * With nothing picked, Enter (or Estimate) asks Bedrock for one serving's nutrition, saves it to the
 * Library and logs it scaled to the amount. "Type nutrition by hand" switches to typing one
 * serving's numbers yourself (servings only, no gram weight). "Build a Recipe" opens the Recipe
 * builder (ticket 17) on its own screen; what it logs comes back through `onAdd`.
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
  const [building, setBuilding] = useState(false);
  const { foods } = useLibrary();
  // Ticket 14 passes the Member's Favorite ids here ({ favoriteIds }) so they rank first.
  const hits = useMemo(() => (byHand ? [] : searchLibrary(foods, name)), [foods, name, byHand]);
  /** A match chosen with the arrow keys (null: none, by Escape), only for the text it was chosen on. */
  const [cursor, setCursor] = useState<{ name: string; id: string | null }>();
  const pickedId = cursor?.name === name ? cursor.id : (hits.find((h) => h.whole)?.item.id ?? null);
  const known = hits.find((h) => h.item.id === pickedId)?.item;
  const units = formUnits(known, byHand);
  const listId = useId();
  /** The picked unit, or serving when the typed name no longer offers it. */
  const shownUnit = units.includes(unit) ? unit : SERVING;

  function resetAmount() {
    setAmount("1");
    setUnit(SERVING);
  }

  /** Log `food` at the typed amount; the unit when it has it, else servings. */
  function logLibraryFood(food: Food) {
    const u = food.units.some((x) => x.label === unit) ? unit : SERVING;
    const a = parseAmount(amount, u);
    if (!a.ok) return setError(a.error);
    const r = logFood(food, { amount: a.amount, unit: u }, meal);
    if (!r.ok) return setError(r.error);
    setError(undefined);
    onAdd(r.entry);
    setName("");
    setCursor(undefined);
    resetAmount();
  }

  /** Arrow keys move through the matches; Escape picks none, so Enter estimates the text. */
  function onFoodKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hits.length) return;
    const at = hits.findIndex((h) => h.item.id === pickedId);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % hits.length;
    else if (e.key === "ArrowUp") next = at <= 0 ? hits.length - 1 : at - 1;
    else if (e.key === "Escape") return setCursor({ name, id: null });
    else return;
    e.preventDefault();
    setCursor({ name, id: hits[next].item.id });
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
    if (known) return logLibraryFood(known);
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
          placeholder={byHand ? "What did you eat?" : "Search the Library or type a new Food"}
          value={name}
          role={byHand ? undefined : "combobox"}
          aria-autocomplete={byHand ? undefined : "list"}
          aria-expanded={byHand ? undefined : hits.length > 0}
          aria-controls={byHand ? undefined : listId}
          aria-activedescendant={known ? `${listId}-${known.id}` : undefined}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onFoodKey}
        />
        <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </select>
      </div>
      {hits.length > 0 && (
        <ul className="search-hits" id={listId} role="listbox" aria-label="Library matches">
          {hits.map(({ item }) => (
            <li
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={item.id === pickedId}
              // Keep focus (and the keyboard) in the Food box on a tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !busy && logLibraryFood(item)}
            >
              {item.name}
            </li>
          ))}
        </ul>
      )}
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
        <button type="button" className="link" onClick={() => { setByHand(!byHand); setUnit(SERVING); setCursor(undefined); setError(undefined); }}>
          {byHand ? "Estimate instead" : "Type nutrition by hand"}
        </button>
        <button type="button" className="link" onClick={() => setBuilding(true)}>Build a Recipe</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {building && <RecipeBuilder meal={meal} onClose={() => setBuilding(false)} onLog={(entry) => { setBuilding(false); onAdd(entry); }} />}
    </form>
  );
}
