import { useEffect, useState } from "react";
import { GOAL_FIELDS, goalsToForm, readGoalsForm, type GoalsFormValues } from "./goalsForm";
import { useGoals } from "./useGoals";
import "./goals.css";

const MACROS = new Set(["carbs", "protein", "fat", "fiber", "calories"]);
const GROUPS = [
  { label: "Macros", fields: GOAL_FIELDS.filter((f) => MACROS.has(f.key)) },
  { label: "Micronutrients", fields: GOAL_FIELDS.filter((f) => f.key === "sodium" || f.key === "iron") },
  { label: "Water", fields: GOAL_FIELDS.filter((f) => f.key === "water") },
];

/** The Goals tab: a daily target for every tracked nutrient and for water. Blank = no goal. */
export function Goals() {
  const { goals, error: loadError, save } = useGoals();
  const [values, setValues] = useState<GoalsFormValues>();
  const [status, setStatus] = useState<{ error?: string; saved?: boolean }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (goals && !values) setValues(goalsToForm(goals)); }, [goals, values]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    const r = readGoalsForm(values);
    if (!r.ok) return setStatus({ error: r.error });
    setBusy(true);
    try {
      await save(r.goals);
      setStatus({ saved: true });
    } catch (err) {
      setStatus({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="goals">
      <h2>Goals</h2>
      <p className="hint">Daily targets for the bars on Today and Week. Leave a box blank for no goal.</p>
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {!values ? (
        !loadError && <p className="empty">Loading…</p>
      ) : (
        <form className="goals-form" aria-label="Goals" onSubmit={submit}>
          {GROUPS.map((g) => (
            <fieldset key={g.label}>
              <legend>{g.label}</legend>
              {g.fields.map((f) => (
                <label key={f.key}>
                  <span>{f.label} <small>{f.unit}</small></span>
                  <input
                    inputMode={f.key === "water" ? "numeric" : "decimal"}
                    aria-label={`${f.label} goal`}
                    value={values[f.key]}
                    onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setStatus({}); }}
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <button className="primary" disabled={busy}>Save goals</button>
          {status.error && <p className="error" role="alert">{status.error}</p>}
          {status.saved && <p className="hint" role="status">Goals saved.</p>}
        </form>
      )}
    </div>
  );
}
