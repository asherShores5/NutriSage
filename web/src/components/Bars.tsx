import { barGroups, type NutrientKey } from "@nutrisage/shared";
import "./bars.css";

type Amounts = Partial<Record<NutrientKey, number>>;

const fmt = (n: number) => String(Math.round(n));

/**
 * Macro and Micronutrient progress bars for `totals` against `goals` (carbs and fat colored as a
 * shared energy pool). Today shows a Day's totals; Week reuses this for averages and week totals.
 */
export function Bars({ totals, goals, label = "Progress" }: { totals: Amounts; goals: Amounts | undefined; label?: string }) {
  return (
    <section className="bars" aria-label={label}>
      {barGroups(totals, goals ?? {}).map((g) => (
        <div key={g.label} className="bar-group">
          {g.label !== "Macros" && <div className="bar-group-label">{g.label}</div>}
          {g.rows.map((r) => (
            <div key={r.key} className="bar" data-nutrient={r.key} data-state={r.state || undefined}>
              <div className="bar-head">
                <span>{r.label}</span>
                <span className="bar-value">{r.goal > 0 ? `${fmt(r.value)} / ${fmt(r.goal)} ${r.unit}` : `${fmt(r.value)} ${r.unit}`}</span>
              </div>
              <div className="bar-track" role="progressbar" aria-label={r.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct}>
                <div className={`bar-fill ${r.state}`} style={{ width: `${r.pct}%` }} />
              </div>
              {r.note && <div className="bar-note">{r.note}</div>}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
