import { useState } from "react";
import { TREND_METRICS, dateKey, defaultYMode, lastDays, trendBounds, trendSeries, trendSummary, type TrendMetric } from "@nutrisage/shared";
import { useDays } from "../week/useDays";
import { TrendChart } from "./TrendChart";
import "./trends.css";

/** Days shown by the current chart (ticket 21 adds range presets). */
export const TREND_DAYS = 30;

/** The Trends tab: one metric over the last 30 Days (parity with the old chart; M4 tickets 20-23 extend it). */
export function Trends() {
  const today = dateKey(new Date());
  const keys = lastDays(today, TREND_DAYS);
  const range = { from: keys[0], to: today };
  const { days, error } = useDays(range.from, range.to);
  const [metric, setMetric] = useState<TrendMetric>("calories");
  const info = TREND_METRICS.find((m) => m.key === metric)!;

  const points = days ? trendSeries(days, metric, range) : [];
  const summary = trendSummary(points);
  return (
    <div className="trends">
      <div className="card-head">
        <h2>Trends</h2>
        <select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as TrendMetric)}>
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
          <TrendChart points={points} bounds={trendBounds(points, defaultYMode(metric))} showMin={defaultYMode(metric) === "fit"} label={`${info.label}, last ${TREND_DAYS} days`} />
        </section>
      )}
    </div>
  );
}
