import { useId, useMemo, useState } from "react";
import {
  MEALS, MEAL_LABELS, NUTRIENTS, QUICK_ADD_PORTION, SERVING, formatAmount, isRecipe, logLibraryItem, parseAmount, recipeUnits, searchLibrary,
  type Amount, type Entry, type LibraryItem, type Meal,
} from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { AmountPicker } from "../../components/AmountPicker";
import { StarButton } from "../../components/StarButton";
import { useFavoriteIds, useFavorites } from "../../library/useFavorites";
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
 * Saved Recipes are matches too (ticket 19): one logs in a fraction of the batch or g as picked,
 * else 1/4 of the batch (recipePortion). Each match has its Favorite star.
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
  const { items } = useLibrary();
  // The Member's Favorites rank first among the matches.
  const favoriteIds = useFavoriteIds();
  const favorites = useFavorites();
  const hits = useMemo(() => (byHand ? [] : searchLibrary(items, name, { favoriteIds })), [items, name, byHand, favoriteIds]);
  /** A match chosen with the arrow keys (null: none, by Escape), only for the text it was chosen on. */
  const [cursor, setCursor] = useState<{ name: string; id: string | null }>();
  const pickedId = cursor?.name === name ? cursor.id : (hits.find((h) => h.whole)?.item.id ?? null);
  const known = hits.find((h) => h.item.id === pickedId)?.item;
  const units = formUnits(known, byHand);
  const listId = useId();
  /** The picked unit, or the first offered (serving; a Recipe's batch, at 1/4) when the typed name doesn't offer it. */
  const fitsUnit = units.includes(unit);
  const shownUnit = fitsUnit ? unit : units[0];
  const shownAmount = !fitsUnit && known && isRecipe(known) ? formatAmount(QUICK_ADD_PORTION.amount) : amount;

  function resetAmount() {
    setAmount("1");
    setUnit(SERVING);
  }

  /** Log a Food at the typed amount (the unit when it has it, else servings), or a Recipe in its unit, else 1/4 of the batch. */
  function logLibraryFood(item: LibraryItem) {
    const fits = isRecipe(item) ? recipeUnits(item).includes(unit) : item.units.some((x) => x.label === unit);
    let to: Amount;
    if (fits || !isRecipe(item)) {
      const u = fits ? unit : SERVING;
      const a = parseAmount(amount, u);
      if (!a.ok) return setError(a.error);
      to = { amount: a.amount, unit: u };
    } else to = { ...QUICK_ADD_PORTION };
    const r = logLibraryItem(item, to, meal);
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
    if (known) return logLibraryFood(known);
    const a = parseAmount(amount, shownUnit);
    if (!a.ok) return setError(a.error);
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
              <span className="search-hit-name">
                {item.name}
                {isRecipe(item) && <small className="item-kind"> Recipe</small>}
              </span>
              {favorites.loaded && (
                // A tap on the star stars it; it doesn't log the match.
                <span onClick={(e) => e.stopPropagation()}>
                  <StarButton name={item.name} starred={favorites.isFavorite(item.id)} onToggle={() => favorites.toggle(item.id)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <AmountPicker amount={shownAmount} unit={shownUnit} units={units} onAmount={(t) => { setAmount(t); setUnit(shownUnit); }} onUnit={(u) => { setAmount(shownAmount); setUnit(u); }} />
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
