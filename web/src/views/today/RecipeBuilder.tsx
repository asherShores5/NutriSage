import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BATCH, MEALS, MEAL_LABELS, SERVING, isWeighed, preparedWeight, rawWeight, recipeTotals, searchLibrary, yieldOf,
  type Entry, type Food, type Meal, type Nutrition,
} from "@nutrisage/shared";
import { estimate } from "../../api/estimate";
import { putYieldRatio, suggestYieldRatio } from "../../api/library";
import { addRecipe } from "../../api/recipes";
import { AmountPicker } from "../../components/AmountPicker";
import { rememberFood, useLibrary } from "../../library/useLibrary";
import {
  PORTION_UNITS, foodFromEstimate, needsYieldSuggestion, preparedNote, readBuilder, readPrepared, readRows, readYieldRatio, switchPortionUnit,
  withYieldRatio, type IngredientRow,
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
 * Ticket 18: unweighed, the Prepared weight is estimated from each ingredient's Yield ratio (so a
 * portion still logs in g). A Library Food with no ratio gets one suggested by Bedrock when added;
 * a typed ratio changes the estimate at once and is saved on the Food when the box loses focus.
 * Ticket 19 adds Recipes as ingredients.
 */
export function RecipeBuilder({ meal: startMeal, onLog, onClose }: {
  meal: Meal;
  onLog: (entry: Omit<Entry, "id">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [query, setQuery] = useState("");
  const [prepared, setPrepared] = useState("");
  const [portion, setPortion] = useState("1");
  const [portionUnit, setPortionUnit] = useState<string>(BATCH);
  const [meal, setMeal] = useState(startMeal);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Yield ratio boxes as typed, by row key (absent: show the Food's ratio). */
  const [yieldText, setYieldText] = useState<Record<string, string>>({});
  const [yieldErrors, setYieldErrors] = useState<Record<string, string>>({});
  /** Food ids Bedrock is being asked about. */
  const [suggesting, setSuggesting] = useState<ReadonlySet<string>>(new Set());
  const { foods } = useLibrary();
  const hits = useMemo(() => searchLibrary(foods, query), [foods, query]);
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => nameBox.current?.focus(), []);

  const { ingredients, byKey, errors } = readRows(rows);
  const totals = recipeTotals({ ingredients });
  const raw = rawWeight({ ingredients });
  const preparedGrams = readPrepared(prepared);
  const weight = preparedWeight({ ingredients, preparedGrams: preparedGrams.ok ? preparedGrams.grams : null });
  const preview = readBuilder({ name: name || "Recipe", rows, prepared, portion, portionUnit, meal });

  /** Rows of the same Food share its Yield ratio. */
  const sameFood = (row: IngredientRow, food: Food) => (food.id ? row.food.id === food.id : row.food === food);

  /** Ask Bedrock for the Food's Yield ratio; rows still without one take it. A failure just leaves it at 1. */
  async function suggest(food: Food) {
    setSuggesting((s) => new Set(s).add(food.id));
    try {
      const f = await suggestYieldRatio(food);
      if (!f.yieldRatio) return;
      rememberFood(f);
      setRows((list) => list.map((r) => (sameFood(r, f) && !r.food.yieldRatio ? { ...r, food: f } : r)));
    } catch {
      // Counted as 1; the Member can type a ratio.
    } finally {
      setSuggesting((s) => { const n = new Set(s); n.delete(food.id); return n; });
    }
  }

  function addFood(food: Food, { estimated = false } = {}) {
    setRows((list) => [...list, { key: crypto.randomUUID(), food, amount: "1", unit: SERVING }]);
    setQuery("");
    setError(undefined);
    // An ingredient estimate already asked Bedrock for the ratio.
    if (!estimated && !suggesting.has(food.id) && needsYieldSuggestion(food)) void suggest(food);
  }

  /** A typed Yield ratio: the estimate follows at once (every row of that Food). */
  function typeYield(row: IngredientRow, text: string) {
    setYieldText((t) => ({ ...t, [row.key]: text }));
    setYieldErrors(({ [row.key]: _, ...rest }) => rest);
    const r = readYieldRatio(text);
    if (r.ok) setRows((list) => list.map((x) => (sameFood(x, row.food) ? { ...x, food: withYieldRatio(x.food, r.ratio) } : x)));
  }

  /** On leaving the box: save a changed ratio on the Library Food, for next time. */
  async function saveYield(row: IngredientRow) {
    const text = yieldText[row.key];
    if (text === undefined) return;
    const r = readYieldRatio(text);
    if (!r.ok) return setYieldErrors((e) => ({ ...e, [row.key]: r.error }));
    setYieldText(({ [row.key]: _, ...rest }) => rest);
    const inLibrary = foods.find((f) => f.id === row.food.id);
    if (!inLibrary || (inLibrary.yieldRatio ?? null) === r.ratio) return;
    try {
      rememberFood(await putYieldRatio(inLibrary, r.ratio));
    } catch (err) {
      setYieldErrors((e) => ({ ...e, [row.key]: `Couldn't save the Yield ratio: ${plain(err)}` }));
    }
  }

  async function addIngredient(e: React.FormEvent) {
    e.preventDefault();
    // React events bubble through the portal to the add box's form: keep this submit here.
    e.stopPropagation();
    if (busy) return;
    const text = query.trim();
    if (!text) return setError("Type an ingredient to search or estimate");
    const whole = hits.find((h) => h.whole)?.item;
    if (whole) return addFood(whole);
    setBusy(true);
    setError(undefined);
    try {
      const est = await estimate(text, { ingredient: true });
      if (est.food) rememberFood(est.food);
      addFood(foodFromEstimate(est), { estimated: true });
    } catch (err) {
      setError(plain(err));
    } finally {
      setBusy(false);
    }
  }

  const setRow = (key: string, change: Partial<IngredientRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function log() {
    if (busy) return;
    const id = save ? crypto.randomUUID() : undefined;
    const r = readBuilder({ name, rows, prepared, portion, portionUnit, meal }, id);
    if (!r.ok) return setError(r.error);
    setError(undefined);
    if (id) {
      setBusy(true);
      try {
        await addRecipe(id, r.recipe);
      } catch (err) {
        setBusy(false);
        return setError(`Couldn't save to the Recipe Book: ${plain(err)}. Turn off Save to Recipe Book to log it anyway.`);
      }
      setBusy(false);
    }
    onLog(r.entry);
  }

  // A portal: the builder is its own screen, outside the add box's form (forms can't nest).
  return createPortal(
    <div className="recipe-backdrop">
      <section className="recipe-builder" role="dialog" aria-modal="true" aria-label="Recipe builder" aria-busy={busy} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="recipe-head">
          <h2>Build a Recipe</h2>
          <button type="button" onClick={onClose}>Cancel</button>
        </header>

        <label className="recipe-field">
          <span>Recipe name</span>
          <input ref={nameBox} aria-label="Recipe name" placeholder="e.g. Chili" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>

        <form className="recipe-add" aria-label="Add an ingredient" onSubmit={addIngredient}>
          <div className="recipe-add-row">
            <input aria-label="Ingredient" placeholder="Search the Library or type a new Food" value={query} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
            <button disabled={busy}>{busy ? "Estimating…" : hits.some((h) => h.whole) ? "Add" : "Estimate"}</button>
          </div>
          {hits.length > 0 && (
            <ul className="search-hits" role="listbox" aria-label="Library matches">
              {hits.map(({ item }) => (
                <li key={item.id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => !busy && addFood(item)}>
                  {item.name}
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
                <li key={row.key} role="group" aria-label={row.food.name}>
                  <div className="recipe-ingredient-head">
                    <span className="entry-name">{row.food.name}</span>
                    <span className="entry-cal">{ing ? `${r0(ing.nutrition.calories)} cal` : "–"}</span>
                    <button type="button" className="link danger-link" aria-label={`Remove ${row.food.name}`} onClick={() => setRows((l) => l.filter((r) => r.key !== row.key))}>Remove</button>
                  </div>
                  <AmountPicker
                    amount={row.amount}
                    unit={row.unit}
                    units={row.food.units.map((u) => u.label)}
                    onAmount={(amount) => setRow(row.key, { amount })}
                    onUnit={(unit) => setRow(row.key, { unit })}
                  />
                  {isWeighed(row.food) && (
                    <div className="recipe-yield">
                      <label>
                        <span>Yield ×</span>
                        <input
                          aria-label="Yield ratio" inputMode="decimal" placeholder="1" autoComplete="off"
                          value={yieldText[row.key] ?? (row.food.yieldRatio ? String(row.food.yieldRatio) : "")}
                          onChange={(e) => typeYield(row, e.target.value)}
                          onBlur={() => void saveYield(row)}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
                        />
                      </label>
                      <small>
                        {suggesting.has(row.food.id) ? "Asking Bedrock…"
                          : !row.food.yieldRatio ? "Unknown, counted as 1"
                          : ing?.grams ? `${r0(ing.grams)} g raw → ${r0(ing.grams * yieldOf(ing))} g prepared` : "Prepared / raw weight"}
                      </small>
                    </div>
                  )}
                  {yieldErrors[row.key] && <p className="error" role="alert">{yieldErrors[row.key]}</p>}
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
          <input
            aria-label="Prepared weight" inputMode="decimal" autoComplete="off" value={prepared} onChange={(e) => setPrepared(e.target.value)}
            placeholder={weight?.source === "estimated" ? `Estimated ${r0(weight.grams)} g` : "Weigh the finished batch"}
          />
          {rows.length > 0 && (
            <small className="prepared-note" data-source={preparedGrams.ok ? (weight?.source ?? "unknown") : "error"}>
              {preparedGrams.ok ? preparedNote(weight) : preparedGrams.error}
            </small>
          )}
        </label>

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

        {error && <p className="error" role="alert">{error}</p>}
        <div className="recipe-actions">
          <button type="button" className="primary" disabled={busy} onClick={log}>Log Recipe</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
