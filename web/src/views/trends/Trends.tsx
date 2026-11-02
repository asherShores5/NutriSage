import { useState } from "react";
import { TREND_ALL_FROM, TREND_METRICS, dateKey, defaultYMode, presetRange, trendBounds, trendBucket, trendSeries, trendSummary, type TrendMetric, type TrendRange } from "@nutrisage/shared";
import { useDays } from "../week/useDays";
import { TrendChart } from "./TrendChart";
import { TrendRangeControls, choiceLabel, type TrendRangeChoice } from "./TrendRangeControls";
import "./trends.css";

/** The range Trends opens on. */
const DEFAULT_RANGE: TrendRangeChoice = { preset: "30d" };

/**
 * The Trends tab: one metric over a range (presets or custom; over ~90 days, weekly averages).
 * Unlogged Days are no data, bridged with a dashed segment; today is in progress. Tickets 22-23
 * add Y-axis modes/goal line and a second metric.
 */
export function Trends() {
  const today = dateKey(new Date());
  const [choice, setChoice] = useState<TrendRangeChoice>(DEFAULT_RANGE);
  // One range query per choice. All asks from TREND_ALL_FROM and then starts at the oldest Day returned.
  const query: TrendRange = "custom" in choice ? choice.custom : choice.preset === "all" ? { from: TREND_ALL_FROM, to: today } : presetRange(choice.preset, today);
  const { days, error } = useDays(query.from, query.to);
  const range = "preset" in choice && choice.preset === "all" ? presetRange("all", today, days && Object.keys(days).sort()[0]) : query;
  const bucket = trendBucket(range);
  const [metric, setMetric] = useState<TrendMetric>("calories");
  const info = TREND_METRICS.find((m) => m.key === metric)!;

  const points = days ? trendSeries(days, metric, range, { today, bucket }) : [];
  const summary = trendSummary(points);
  const label = choiceLabel(choice);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  const weekly = bucket === "week";
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
      <TrendRangeControls value={choice} today={today} onChange={setChoice} />
      {error && <p className="error" role="alert">{error}</p>}
      {!days && !error && <p className="empty">Loading…</p>}
      {days && (
        <section className="card trend-card" aria-label="Trend">
          <p className="hint trend-summary">
            {summary.logged
              ? `${label}${weekly ? " · weekly averages" : ""} · ${summary.logged} ${weekly ? "weeks " : ""}logged · max ${summary.max}`
              : `No data for ${lower}.`}
          </p>
          <TrendChart points={points} bounds={trendBounds(points, defaultYMode(metric))} showMin={defaultYMode(metric) === "fit"} label={`${info.label}, ${lower}`} />
          {summary.logged > 0 && (
            <p className="hint trend-legend">
              {weekly ? "Each dot: a week's average over logged Days. Dashed: weeks with no data." : "Dashed: Days with no data."}
              {points.some((pt) => pt.inProgress) && (weekly ? " Hollow dot: this week, in progress." : " Hollow dot: today, in progress.")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
