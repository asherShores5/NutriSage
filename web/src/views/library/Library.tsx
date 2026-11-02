import { useMemo, useState } from "react";
import { NUTRIENTS, foodEdit, foodNameKey, type Food } from "@nutrisage/shared";
import { deleteFood, putFood } from "../../api/library";
import { NetworkError } from "../../api/errors";
import { isGuest } from "../../session";
import { foodToForm, readFoodForm, type FoodFormValues } from "../../library/foodForm";
import { forgetFood, rememberFood, useLibrary } from "../../library/useLibrary";
import "./library.css";

/**
 * The Library screen (ticket 15), opened from Profile: every Food, and an editor for its name,
 * nutrition per serving, units and Yield ratio, or to delete it. Either Member may edit any Food;
 * a Guest edits their own device Library. Entries already logged keep their snapshots.
 */
export function Library({ onClose }: { onClose: () => void }) {
  const { foods, loaded, error } = useLibrary();
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string>();
  const shown = useMemo(() => {
    const key = foodNameKey(filter);
    return foods.filter((f) => !key || foodNameKey(f.name).includes(key)).sort((a, b) => a.name.localeCompare(b.name));
  }, [foods, filter]);
  const open = foods.find((f) => f.id === openId);

  return (
    <div className="library">
      <div className="library-head">
        <button type="button" className="link" onClick={onClose}>‹ Profile</button>
        <h2>Library</h2>
      </div>
      <p className="hint">{isGuest() ? "The Foods on this device." : "Every Food either of you has logged."} Fix a name or the nutrition here; Entries already logged don't change.</p>
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
                  <button type="button" onClick={() => setOpenId(f.id)}>
                    <span className="library-name">{f.name}</span>
                    <small>{summary(f)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** "180 cal · 120 g serving" (or "per serving" when its weight isn't known). */
function summary(food: Food) {
  const e = foodEdit(food);
  return `${Math.round(e.nutrition.calories)} cal · ${e.servingGrams === null ? "per serving" : `${Math.round(e.servingGrams)} g serving`}`;
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
      if (msg.startsWith("NotFound")) forgetFood(food.id); // the other Member deleted it meanwhile
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
    void run(async () => forgetFood(await deleteFood(food.id)));
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
