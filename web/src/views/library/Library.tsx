import { useMemo, useState } from "react";
import { NUTRIENTS, foodEdit, foodNameKey, preparedWeight, recipeTotals, type Food, type Recipe } from "@nutrisage/shared";
import { deleteFood, putFood } from "../../api/library";
import { NetworkError } from "../../api/errors";
import { StarButton } from "../../components/StarButton";
import { isGuest } from "../../session";
import { foodToForm, readFoodForm, type FoodFormValues } from "../../library/foodForm";
import { forgetFavorite, useFavorites } from "../../library/useFavorites";
import { forgetFood, rememberFood, useLibrary } from "../../library/useLibrary";
import { RecipeBuilder } from "../today/RecipeBuilder";
import "./library.css";

/**
 * The Library screen (ticket 15), opened from Profile: every Food, and an editor for its name,
 * nutrition per serving, units and Yield ratio, or to delete it. Either Member may edit any Food;
 * a Guest edits their own device Library. Entries already logged keep their snapshots.
 * Ticket 19: the Recipe Book below the Foods; a Recipe opens in the Recipe builder to edit its
 * ingredients and Prepared weight, or delete it. Every Food and Recipe has its Favorite star.
 */
export function Library({ onClose }: { onClose: () => void }) {
  const { foods, recipes, loaded, error } = useLibrary();
  const favorites = useFavorites();
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string>();
  const [openRecipeId, setOpenRecipeId] = useState<string>();
  const matching = <T extends { name: string }>(list: T[]) => {
    const key = foodNameKey(filter);
    return list.filter((f) => !key || foodNameKey(f.name).includes(key)).sort((a, b) => a.name.localeCompare(b.name));
  };
  const shown = useMemo(() => matching(foods), [foods, filter]);
  const shownRecipes = useMemo(() => matching(recipes), [recipes, filter]);
  const open = foods.find((f) => f.id === openId);
  const openRecipe = recipes.find((r) => r.id === openRecipeId);
  const star = (id: string, name: string) =>
    favorites.loaded && <StarButton name={name} starred={favorites.isFavorite(id)} onToggle={() => favorites.toggle(id)} />;

  return (
    <div className="library">
      <div className="library-head">
        <button type="button" className="link" onClick={onClose}>‹ Profile</button>
        <h2>Library</h2>
      </div>
      <p className="hint">{isGuest() ? "The Foods and Recipes on this device." : "Every Food and Recipe either of you has logged or saved."} Fix a name or the nutrition here; Entries already logged don't change.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {open ? (
        <FoodEditor key={open.id} food={open} onDone={() => setOpenId(undefined)} />
      ) : (
        <>
          <input type="search" aria-label="Filter the Library" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {!loaded ? (
            !error && <p className="empty">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="empty">{foods.length ? "No Food matches." : "The Library is empty. Foods join it when you estimate them."}</p>
          ) : (
            <ul className="library-list" aria-label="Foods">
              {shown.map((f) => (
                <li key={f.id}>
                  <button type="button" className="library-open" onClick={() => setOpenId(f.id)}>
                    <span className="library-name">{f.name}</span>
                    <small>{summary(f)}</small>
                  </button>
                  {star(f.id, f.name)}
                </li>
              ))}
            </ul>
          )}
          {loaded && (
            <>
              <h3 className="library-section">Recipe Book</h3>
              {shownRecipes.length === 0 ? (
                <p className="empty">{recipes.length ? "No Recipe matches." : "No Recipes yet. Build one from Today's add box and keep Save to Recipe Book on."}</p>
              ) : (
                <ul className="library-list" aria-label="Recipe Book">
                  {shownRecipes.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="library-open" onClick={() => setOpenRecipeId(r.id)}>
                        <span className="library-name">{r.name}</span>
                        <small>{recipeSummary(r)}</small>
                      </button>
                      {star(r.id, r.name)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      {openRecipe && <RecipeBuilder key={openRecipe.id} recipe={openRecipe} onClose={() => setOpenRecipeId(undefined)} onSaved={() => setOpenRecipeId(undefined)} />}
    </div>
  );
}

/** "180 cal · 120 g serving" (or "per serving" when its weight isn't known). */
function summary(food: Food) {
  const e = foodEdit(food);
  return `${Math.round(e.nutrition.calories)} cal · ${e.servingGrams === null ? "per serving" : `${Math.round(e.servingGrams)} g serving`}`;
}

/** "1610 cal · 1200 g batch · 3 ingredients". */
function recipeSummary(recipe: Recipe) {
  const w = preparedWeight(recipe);
  const n = recipe.ingredients.length;
  return `${Math.round(recipeTotals(recipe).calories)} cal${w ? ` · ${Math.round(w.grams)} g batch` : ""} · ${n} ingredient${n === 1 ? "" : "s"}`;
}

function FoodEditor({ food, onDone }: { food: Food; onDone: () => void }) {
  const [values, setValues] = useState<FoodFormValues>(() => foodToForm(food));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const change = (next: Partial<FoodFormValues>) => { setValues({ ...values, ...next }); setError(undefined); };
  const setUnit = (i: number, part: Partial<FoodFormValues["units"][number]>) => change({ units: values.units.map((u, j) => (j === i ? { ...u, ...part } : u)) });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      if (e instanceof NetworkError) return setError("You're offline. Library changes need a connection; try again when you're back.");
      const msg = (e as Error).message;
      if (msg.startsWith("NotFound")) { forgetFood(food.id); forgetFavorite(food.id); } // the other Member deleted it meanwhile
      setError(msg.replace(/^(ValidationError|NotFound): /, ""));
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const r = readFoodForm(values);
    if (!r.ok) return setError(r.error);
    void run(async () => rememberFood(await putFood(food.id, r.edit)));
  }

  function remove() {
    if (!confirm(`Delete ${food.name} from the Library? It leaves everyone's Quick Add. Entries already logged stay.`)) return;
    void run(async () => {
      const id = await deleteFood(food.id);
      forgetFood(id);
      forgetFavorite(id); // the server already dropped it from every Member's Favorites
    });
  }

  return (
    <form className="food-editor" aria-label={`Edit ${food.name}`} onSubmit={save}>
      <label className="wide">
        <span>Name</span>
        <input aria-label="Name" value={values.name} onChange={(e) => change({ name: e.target.value })} />
      </label>
      <label>
        <span>Serving weight <small>g</small></span>
        <input inputMode="decimal" aria-label="Serving weight" placeholder="unknown" value={values.servingGrams} onChange={(e) => change({ servingGrams: e.target.value })} />
      </label>
      <label>
        <span>Yield ratio <small>prepared ÷ raw</small></span>
        <input inputMode="decimal" aria-label="Yield ratio" placeholder="none" value={values.yieldRatio} onChange={(e) => change({ yieldRatio: e.target.value })} />
      </label>
      <fieldset>
        <legend>Nutrition in one serving</legend>
        {NUTRIENTS.map((n) => (
          <label key={n.key}>
            <span>{n.label} <small>{n.unit}</small></span>
            <input inputMode="decimal" aria-label={n.label} value={values.nutrition[n.key]} onChange={(e) => change({ nutrition: { ...values.nutrition, [n.key]: e.target.value } })} />
          </label>
        ))}
      </fieldset>
      <fieldset className="food-units">
        <legend>Units</legend>
        <p className="hint">serving{values.servingGrams.trim() ? " and g are" : " is"} always there. Add others with the grams in one (egg, cup, slice).</p>
        {values.units.map((u, i) => (
          <div className="food-unit" key={i} role="group" aria-label={`Unit ${i + 1}`}>
            <input aria-label="Unit name" placeholder="name" value={u.label} onChange={(e) => setUnit(i, { label: e.target.value })} />
            <input inputMode="decimal" aria-label="Unit grams" placeholder="g" value={u.grams} onChange={(e) => setUnit(i, { grams: e.target.value })} />
            <button type="button" aria-label={`Remove ${u.label || "unit"}`} onClick={() => change({ units: values.units.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => change({ units: [...values.units, { label: "", grams: "" }] })}>+ Add a unit</button>
      </fieldset>
      {error && <p className="error wide" role="alert">{error}</p>}
      <div className="food-editor-actions wide">
        <button type="button" className="danger" disabled={busy} onClick={remove}>Delete</button>
        <button type="button" disabled={busy} onClick={onDone}>Cancel</button>
        <button className="primary" disabled={busy}>Save</button>
      </div>
    </form>
  );
}
