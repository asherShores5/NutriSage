import "./amount.css";

/** One-tap amounts (spec story 23). */
export const QUICK_AMOUNTS = ["1/4", "1/2", "1", "2"] as const;

/**
 * The amount box, its unit picker and quick buttons, shared by the add box and the Entry editor.
 * It only holds what's typed: the caller parses it (parseAmount) and shows any message.
 */
export function AmountPicker({ amount, unit, units, onAmount, onUnit }: {
  /** What's typed ("1 1/2"). */
  amount: string;
  unit: string;
  /** Unit labels to offer, e.g. ["serving", "g"]. */
  units: readonly string[];
  onAmount: (text: string) => void;
  onUnit: (unit: string) => void;
}) {
  return (
    <div className="amount-picker">
      <input
        aria-label="Amount"
        className="amount-input"
        autoComplete="off"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
      />
      <select aria-label="Unit" value={unit} disabled={units.length < 2} onChange={(e) => onUnit(e.target.value)}>
        {units.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      {unit !== "g" && (
        <div className="quick-amounts" role="group" aria-label="Quick picks">
          {QUICK_AMOUNTS.map((q) => (
            <button key={q} type="button" aria-pressed={amount.trim() === q} onClick={() => onAmount(q)}>{q}</button>
          ))}
        </div>
      )}
    </div>
  );
}
