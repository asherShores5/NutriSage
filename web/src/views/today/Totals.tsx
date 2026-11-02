import { NUTRIENTS, sumMacros, type Entry } from "@nutrisage/shared";

/** The Day's totals for every nutrient. Ticket 04 turns these into goal bars. */
export function Totals({ entries }: { entries: Entry[] }) {
  const total = sumMacros(entries);
  return (
    <section className="totals" aria-label="Totals">
      {NUTRIENTS.map((n) => (
        <div key={n.key} className="total">
          <span className="total-value">{Math.round(total[n.key] * 10) / 10}</span>
          <span className="total-label">{n.label} <small>{n.unit}</small></span>
        </div>
      ))}
    </section>
  );
}
