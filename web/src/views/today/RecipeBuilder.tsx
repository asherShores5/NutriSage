import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BATCH, MEALS, MEAL_LABELS, QUICK_ADD_PORTION, SERVING, formatAmount, ingredientFromRecipe, isRecipe, preparedWeight, rawWeight, recipeTotals, searchLibrary,
  type Entry, type Food, type LibraryItem, type Meal, type Nutrition, type Recipe,
} from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { NetworkError } from "../../api/errors";
import { addRecipe, deleteRecipe, putRecipe } from "../../api/recipes";
import { AmountPicker } from "../../components/AmountPicker";
import { forgetFavorite } from "../../library/useFavorites";
import { forgetRecipe, rememberFood, rememberRecipe, useLibrary } from "../../library/useLibrary";
import {
  PORTION_UNITS, foodFromEstimate, readBuilder, readEdit, readPrepared, readRows, rowName, rowUnits, rowsFromRecipe, switchPortionUnit, type IngredientRow,
} from "./recipeBuilder";
import "./recipe.css";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^(ValidationError|Unavailable): /, "");

function Totals({ label, n, grams }: { label: string; n: Nutrition; grams?: string }) {
  return (
    <p className="recipe-totals" role="status" aria-label={label}>
      <strong>{label}: {r0(n.calories)} cal</strong>
      <span>{r1(n.carbs)}c / {r1(n.protein)}p / {r1(n.fat)}f · {r1(n.fiber)}g fiber · Na {r0(n.sodium)}mg · Fe {r1(n.iron)}mg</span>
      {grams && <span>{grams}</span>}
    </p>
  );
}

/**
 * The Recipe builder (ticket 17), a screen of its own opened from Today's add box. Ingredients come
 * from the Library (fuzzy search) or a new Bedrock estimate (which joins the Library, Yield ratio
 * included), each with its own amount and unit; totals update live. With the weighed Prepared
 * weight a portion logs in g, without it as a fraction of the batch. It logs as one Entry with its
 * ingredient breakdown; "Save to Recipe Book" (on by default) also keeps the Recipe in the Library.
 * Ticket 18 adds Yield-ratio estimates of the Prepared weight.
 *
 * Ticket 19: saved Recipes are search matches too and join as a portion (1/4 batch to start), one
 * level deep. Given `recipe` (from the Library screen), it edits that saved Recipe instead: the saved
 * ingredients keep their snapshots unless their amount changes, there is no portion to log, and
 * Save changes / Delete replace logging. Entries logged from it never change.
 */
export function RecipeBuilder({ meal: startMeal = "snack", recipe: editing, onLog, onSaved, onClose }: {
  meal?: Meal;
  /** A saved Recipe to edit (no logging then). */
  recipe?: Recipe;
  onLog?: (entry: Omit<Entry, "id">) => void;
  /** After an edit is saved (the Recipe) or the Recipe deleted (null). */
  onSaved?: (recipe: Recipe | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [rows, setRows] = useState<IngredientRow[]>(() => (editing ? rowsFromRecipe(editing) : []));
  const [query, setQuery] = useState("");
  const [prepared, setPrepared] = useState(editing?.preparedGrams ? String(editing.preparedGrams) : "");
  const [portion, setPortion] = useState("1");
  const [portionUnit, setPortionUnit] = useState<string>(BATCH);
  const [meal, setMeal] = useState(startMeal);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { items } = useLibrary();
  // A Recipe can't be an ingredient of itself.
  const library = useMemo(() => (editing ? items.filter((i) => i.id !== editing.id) : items), [items, editing]);
  const hits = useMemo(() => searchLibrary(library, query), [library, query]);
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => nameBox.current?.focus(), []);

  const { ingredients, byKey, errors } = readRows(rows);
  const totals = recipeTotals({ ingredients });
  const raw = rawWeight({ ingredients });
  const preparedGrams = readPrepared(prepared);
  const weight = preparedWeight({ ingredients, preparedGrams: preparedGrams.ok ? preparedGrams.grams : null });
  const preview = readBuilder({ name: name || "Recipe", rows, prepared, portion, portionUnit, meal });

  function addFood(food: Food) {
    setRows((list) => [...list, { key: crypto.randomUUID(), food, amount: "1", unit: SERVING }]);
    setQuery("");
    setError(undefined);
  }

  /** Add a Library match: a Food at 1 serving, a saved Recipe at 1/4 of its batch (refused when it has a Recipe in it). */
  function addItem(item: LibraryItem) {
    if (!isRecipe(item)) return addFood(item);
    const r = ingredientFromRecipe(item, QUICK_ADD_PORTION);
    if (!r.ok) return setError(r.error);
    setRows((list) => [...list, { key: crypto.randomUUID(), recipe: item, amount: formatAmount(QUICK_ADD_PORTION.amount), unit: BATCH }]);
    setQuery("");
    setError(undefined);
  }

  async function addIngredient(e: React.FormEvent) {
    e.preventDefault();
    // React events bubble through the portal to the add box's form: keep this submit here.
    e.stopPropagation();
    if (busy) return;
    const text = query.trim();
    if (!text) return setError("Type an ingredient to search or estimate");
    const whole = hits.find((h) => h.whole)?.item;
    if (whole) return addItem(whole);
    setBusy(true);
    setError(undefined);
    try {
      const est = await estimate(text, { ingredient: true });
      if (est.food) rememberFood(est.food);
      addFood(foodFromEstimate(est));
    } catch (err) {
      setError(plain(err));
    } finally {
      setBusy(false);
    }
  }

  const setRow = (key: string, change: { amount?: string; unit?: string }) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function log() {
    if (busy) return;
    const id = save ? crypto.randomUUID() : undefined;
    const r = readBuilder({ name, rows, prepared, portion, portionUnit, meal }, id);
    if (!r.ok) return setError(r.error);
    setError(undefined);
    if (id) {
      setBusy(true);
      try {
        rememberRecipe(await addRecipe(id, r.recipe));
      } catch (err) {
        setBusy(false);
        return setError(`Couldn't save to the Recipe Book: ${plain(err)}. Turn off Save to Recipe Book to log it anyway.`);
      }
      setBusy(false);
    }
    onLog?.(r.entry);
  }

  /** Run a Recipe Book change; offline and "already gone" get plain messages. */
  async function change(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      if (err instanceof NetworkError) return setError("You're offline. Recipe Book changes need a connection; try again when you're back.");
      const msg = plain(err).replace(/^NotFound: /, "");
      if (editing && /no longer in the Recipe Book/.test(msg)) { forgetRecipe(editing.id); forgetFavorite(editing.id); }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    if (!editing) return;
    const r = readEdit({ name, rows, prepared });
    if (!r.ok) return setError(r.error);
    void change(async () => {
      const saved = await putRecipe(editing.id, r.recipe);
      rememberRecipe(saved);
      onSaved?.(saved);
    });
  }

  function remove() {
    if (!editing) return;
    if (!confirm(`Delete ${editing.name} from the Recipe Book? It leaves everyone's Quick Add. Entries already logged stay.`)) return;
    void change(async () => {
      const id = await deleteRecipe(editing.id);
      forgetRecipe(id);
      forgetFavorite(id); // the server already dropped it from every Member's Favorites
      onSaved?.(null);
    });
  }

  // A portal: the builder is its own screen, outside the add box's form (forms can't nest).
  return createPortal(
    <div className="recipe-backdrop">
      <section className="recipe-builder" role="dialog" aria-modal="true" aria-label={editing ? `Edit ${editing.name}` : "Recipe builder"} aria-busy={busy} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="recipe-head">
          <h2>{editing ? "Edit Recipe" : "Build a Recipe"}</h2>
          <button type="button" onClick={onClose}>Cancel</button>
        </header>

        <label className="recipe-field">
          <span>Recipe name</span>
          <input ref={nameBox} aria-label="Recipe name" placeholder="e.g. Chili" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>

        <form className="recipe-add" aria-label="Add an ingredient" onSubmit={addIngredient}>
          <div className="recipe-add-row">
            <input aria-label="Ingredient" placeholder="Search the Library or type a new Food" value={query} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
            <button disabled={busy}>{busy && !editing ? "Estimating…" : hits.some((h) => h.whole) ? "Add" : "Estimate"}</button>
          </div>
          {hits.length > 0 && (
            <ul className="search-hits" role="listbox" aria-label="Library matches">
              {hits.map(({ item }) => (
                <li key={item.id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => !busy && addItem(item)}>
                  {item.name}
                  {isRecipe(item) && <small className="item-kind"> Recipe</small>}
                </li>
              ))}
            </ul>
          )}
        </form>

        {rows.length > 0 ? (
          <ul className="recipe-ingredients" aria-label="Ingredients">
            {rows.map((row) => {
              const ing = byKey[row.key];
              return (
                <li key={row.key} role="group" aria-label={rowName(row)}>
                  <div className="recipe-ingredient-head">
                    <span className="entry-name">
                      {rowName(row)}
                      {(row.recipe || row.saved?.ingredients?.length) && <small className="item-kind"> Recipe</small>}
                    </span>
                    <span className="entry-cal">{ing ? `${r0(ing.nutrition.calories)} cal` : "–"}</span>
                    <button type="button" className="link danger-link" aria-label={`Remove ${rowName(row)}`} onClick={() => setRows((l) => l.filter((r) => r.key !== row.key))}>Remove</button>
                  </div>
                  <AmountPicker
                    amount={row.amount}
                    unit={row.unit}
                    units={rowUnits(row)}
                    onAmount={(amount) => setRow(row.key, { amount })}
                    onUnit={(unit) => setRow(row.key, { unit })}
                  />
                  {errors[row.key] && <p className="error" role="alert">{errors[row.key]}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty">No ingredients yet.</p>
        )}

        <Totals label="Recipe total" n={totals} grams={raw ? `Raw weight ${r0(raw)} g` : rows.length ? "Raw weight unknown (an ingredient has no gram weight)" : undefined} />

        <label className="recipe-field">
          <span>Prepared weight (g)</span>
          <input aria-label="Prepared weight" inputMode="decimal" placeholder="Weigh the finished batch" value={prepared} autoComplete="off" onChange={(e) => setPrepared(e.target.value)} />
          <small>{preparedGrams.ok ? (weight ? "Weighed" : "Needed to log in g; a fraction of the batch works without it") : preparedGrams.error}</small>
        </label>

        {!editing && (
          <>
            <div className="recipe-portion" role="group" aria-label="Portion">
              <span className="recipe-portion-head">Portion to log</span>
              <AmountPicker amount={portion} unit={portionUnit} units={PORTION_UNITS} onAmount={setPortion} onUnit={(u) => {
                setPortion(switchPortionUnit(portion, portionUnit, u, weight?.grams ?? null));
                setPortionUnit(u);
              }} />
              <select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
                {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
              </select>
            </div>
            {preview.ok && rows.length > 0 && <Totals label="This portion" n={preview.entry.nutrition} grams={preview.entry.grams ? `${r0(preview.entry.grams)} g` : undefined} />}

            <label className="recipe-save">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span>Save to Recipe Book</span>
            </label>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <div className="recipe-actions">
          {editing ? (
            <>
              <button type="button" className="danger" disabled={busy} onClick={remove}>Delete</button>
              <button type="button" className="primary" disabled={busy} onClick={saveEdit}>Save changes</button>
            </>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={log}>Log Recipe</button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
