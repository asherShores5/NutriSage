import { defaultYMode, type ManualBounds, type TrendMetric, type YBounds, type YMode } from "@nutrisage/shared";

/** One series' Y-axis setting. Ticket 23's second metric keeps its own. */
export interface YAxis {
  mode: YMode;
  manual: ManualBounds;
}

/** A metric's starting Y-axis: its default mode, no manual bounds typed yet. */
export const defaultYAxis = (metric: TrendMetric): YAxis => ({ mode: defaultYMode(metric), manual: { min: null, max: null } });

const MODES: { value: YMode; label: string }[] = [
  { value: "fit", label: "Fit to data" },
  { value: "zero", label: "Start at 0" },
  { value: "manual", label: "Manual" },
];

const parse = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const show = (v: number) => String(Math.round(v * 10) / 10);

/**
 * The Y-axis control row for one series: mode, manual min/max, and the goal line toggle (only when
 * the metric has a goal). `bounds` is what the chart draws now: picking Manual starts from it.
 */
export function YAxisControls({ label = "Y-axis", value, onChange, bounds, goal, showGoal, onShowGoal }: {
  label?: string;
  value: YAxis;
  onChange: (next: YAxis) => void;
  bounds: YBounds;
  goal: number | null;
  showGoal: boolean;
  onShowGoal: (on: boolean) => void;
}) {
  const setMode = (mode: YMode) =>
    onChange(mode === "manual" && value.manual.min === null && value.manual.max === null ? { mode, manual: { min: Math.floor(bounds.min), max: Math.ceil(bounds.max) } } : { ...value, mode });
  const { min, max } = value.manual;
  const ignored = value.mode === "manual" && ((min !== null && min !== bounds.min) || (max !== null && max !== bounds.max));
  return (
    <div className="y-axis" role="group" aria-label={label}>
      <label>
        {label}{" "}
        <select aria-label={`${label} scale`} value={value.mode} onChange={(e) => setMode(e.target.value as YMode)}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      {value.mode === "manual" && (
        <>
          <label>
            Min <input type="number" inputMode="decimal" aria-label={`${label} min`} defaultValue={min ?? ""} onChange={(e) => onChange({ ...value, manual: { ...value.manual, min: parse(e.target.value) } })} />
          </label>
          <label>
            Max <input type="number" inputMode="decimal" aria-label={`${label} max`} defaultValue={max ?? ""} onChange={(e) => onChange({ ...value, manual: { ...value.manual, max: parse(e.target.value) } })} />
          </label>
        </>
      )}
      {goal !== null && (
        <label className="y-axis-goal">
          <input type="checkbox" checked={showGoal} onChange={(e) => onShowGoal(e.target.checked)} /> Goal line ({show(goal)})
        </label>
      )}
      {ignored && <p className="hint y-axis-hint" role="status">Min must be below max. Showing {show(bounds.min)} to {show(bounds.max)}.</p>}
    </div>
  );
}
