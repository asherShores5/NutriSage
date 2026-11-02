import { useState } from "react";
import { TREND_METRICS, dateKey, lastDays, trendBounds, trendGoal, trendSeries, trendSummary, type TrendMetric } from "@nutrisage/shared";
import { useGoals } from "../goals/useGoals";
import { useDays } from "../week/useDays";
import { TrendChart } from "./TrendChart";
import { YAxisControls, defaultYAxis } from "./YAxisControls";
import "./trends.css";

/** Days shown by the current chart (ticket 21 adds range presets). */
export const TREND_DAYS = 30;

/**
 * The Trends tab: one metric over the last 30 Days. Unlogged Days are no data, bridged with a
 * dashed segment; today is in progress. The Y-axis is fit, from 0 or manual, with a goal line at the Member's goal (22). Tickets 21 and 23 add range and a second metric.
 */
export function Trends() {
  const today = dateKey(new Date());
  const keys = lastDays(today, TREND_DAYS);
  const range = { from: keys[0], to: today };
  const { days, error } = useDays(range.from, range.to);
  const [metric, setMetric] = useState<TrendMetric>("calories");
  const info = TREND_METRICS.find((m) => m.key === metric)!;
  const { goals } = useGoals();
  const [yAxis, setYAxis] = useState(() => defaultYAxis(metric));
  const [showGoal, setShowGoal] = useState(true);
  const pickMetric = (m: TrendMetric) => { setMetric(m); setYAxis(defaultYAxis(m)); };

  const points = days ? trendSeries(days, metric, range, { today }) : [];
  const summary = trendSummary(points);
  const goal = trendGoal(goals, metric);
  const goalLine = showGoal ? goal : null;
  const bounds = trendBounds(points, yAxis.mode, { manual: yAxis.manual, goal: goalLine });
  return (
    <div className="trends">
      <div className="card-head">
        <h2>Trends</h2>
        <select aria-label="Metric" value={metric} onChange={(e) => pickMetric(e.target.value as TrendMetric)}>
          {TREND_METRICS.map((m) => (
            <option key={m.key} value={m.key}>{m.key === "water" ? "Water (cups)" : m.label}</option>
          ))}
        </select>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!days && !error && <p className="empty">Loading…</p>}
      {days && (
        <section className="card trend-card" aria-label="Trend">
          <p className="hint trend-summary">
            {summary.logged ? `Last ${TREND_DAYS} days · ${summary.logged} logged · max ${summary.max}` : `No data in the last ${TREND_DAYS} days.`}
          </p>
          <YAxisControls key={metric} value={yAxis} onChange={setYAxis} bounds={bounds} goal={goal} showGoal={showGoal} onShowGoal={setShowGoal} />
          <TrendChart points={points} bounds={bounds} showMin={bounds.min !== 0} goal={goalLine} label={`${info.label}, last ${TREND_DAYS} days`} />
          {summary.logged > 0 && <p className="hint trend-legend">Dashed: Days with no data. Hollow dot: today, in progress.</p>}
        </section>
      )}
    </div>
  );
}
