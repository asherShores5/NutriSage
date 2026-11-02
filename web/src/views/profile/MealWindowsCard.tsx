import { useEffect, useState } from "react";
import { DEFAULT_MEAL_WINDOWS, MEAL_LABELS, mealWindowRanges, validateMealWindows, type MealWindows } from "@nutrisage/shared";
import { useMealWindows } from "./useMealWindows";
import "./mealWindows.css";

/** "ValidationError: ..." -> "...": the API's error type isn't for people. */
const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^ValidationError: /, "");

/**
 * The Member's Meal windows: when each Meal starts. Today's Meal picker starts on the Meal whose
 * window holds the time the app was opened. Rows are listed in time order as saved.
 */
export function MealWindowsCard() {
  const { windows, error: loadError, save } = useMealWindows();
  const [values, setValues] = useState<MealWindows>();
  const [status, setStatus] = useState<{ error?: string; saved?: boolean }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (windows && !values) setValues(windows); }, [windows, values]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    const r = validateMealWindows(values);
    if (!r.ok) return setStatus({ error: r.error });
    setBusy(true);
    try {
      await save(r.windows);
      setValues(r.windows);
      setStatus({ saved: true });
    } catch (err) {
      setStatus({ error: plain(err) });
    } finally {
      setBusy(false);
    }
  }

  // Order the rows by the saved windows, so they don't jump around while typing.
  const order = mealWindowRanges(windows ?? DEFAULT_MEAL_WINDOWS);
  return (
    <section className="card meal-windows" aria-labelledby="meal-windows-h">
      <h3 id="meal-windows-h">Meal windows</h3>
      <p className="hint">When each Meal starts. Today picks the Meal for the time you open the app; each Meal runs until the next one starts.</p>
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {!values ? (
        !loadError && <p className="empty">Loading…</p>
      ) : (
        <form aria-label="Meal windows" onSubmit={submit}>
          {order.map(({ meal }) => (
            <label key={meal}>
              <span>{MEAL_LABELS[meal]} starts</span>
              <input
                type="time"
                aria-label={`${MEAL_LABELS[meal]} starts`}
                value={values[meal]}
                onChange={(e) => { setValues({ ...values, [meal]: e.target.value }); setStatus({}); }}
              />
            </label>
          ))}
          <div className="meal-windows-actions">
            <button className="primary" disabled={busy}>Save Meal windows</button>
            <button type="button" className="link" onClick={() => { setValues({ ...DEFAULT_MEAL_WINDOWS }); setStatus({}); }}>Use defaults</button>
          </div>
          {status.error && <p className="error" role="alert">{status.error}</p>}
          {status.saved && <p className="hint" role="status">Meal windows saved.</p>}
        </form>
      )}
    </section>
  );
}
