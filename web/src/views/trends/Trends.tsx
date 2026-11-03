import { useState } from "react";
import { TREND_ALL_FROM, TREND_METRICS, dateKey, presetRange, trendBucket, trendGoal, trendOverlay, trendSummary, type TrendMetric, type TrendRange } from "@nutrisage/shared";
import { useGoals } from "../goals/useGoals";
import { useDays } from "../week/useDays";
import { TrendChart } from "./TrendChart";
import { TrendRangeControls, choiceLabel, type TrendRangeChoice } from "./TrendRangeControls";
import { YAxisControls, defaultYAxis, type YAxis } from "./YAxisControls";
import "./trends.css";

/** The second metric's starting Y-axis: fit to its data, so its shape reads next to the primary's. */
const SECOND_Y_AXIS: YAxis = { mode: "fit", manual: { min: null, max: null } };

/** The range Trends opens on. */
const DEFAULT_RANGE: TrendRangeChoice = { preset: "30d" };

/**
 * The Trends tab: one metric over a range (presets or custom; over ~90 days, weekly averages).
 * Unlogged Days are no data, bridged with a dashed segment; today is in progress. The Y-axis is
 * fit, from 0 or manual, with a goal line at the Member's goal (22). A second metric overlays on a
 * right-hand axis with its own bounds and Y-axis setting, same range and buckets, plus a legend (23).
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
  const { goals } = useGoals();
  const [yAxis, setYAxis] = useState(() => defaultYAxis(metric));
  const [showGoal, setShowGoal] = useState(true);
  const [second, setSecond] = useState<TrendMetric | null>(null);
  const [secondAxis, setSecondAxis] = useState<YAxis>(SECOND_Y_AXIS);
  const secondInfo = TREND_METRICS.find((m) => m.key === second);
  const pickMetric = (m: TrendMetric) => { setMetric(m); setYAxis(defaultYAxis(m)); if (m === second) setSecond(null); };
  const pickSecond = (m: TrendMetric | null) => { setSecond(m); setSecondAxis(SECOND_Y_AXIS); };

  const goal = trendGoal(goals, metric);
  const goalLine = showGoal ? goal : null;
  const overlay = days
    ? trendOverlay(days, range, { today, bucket }, { metric, mode: yAxis.mode, manual: yAxis.manual, goal: goalLine }, second && { metric: second, mode: secondAxis.mode, manual: secondAxis.manual })
    : null;
  const points = overlay?.primary.points ?? [];
  const bounds = overlay?.primary.bounds ?? { min: 0, max: 1 };
  const right = overlay?.second ?? null;
  const summary = trendSummary(points);
  const label = choiceLabel(choice);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  const weekly = bucket === "week";
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
          <YAxisControls key={metric} value={yAxis} onChange={setYAxis} bounds={bounds} goal={goal} showGoal={showGoal} onShowGoal={setShowGoal} />
          <label className="trend-second-pick">
            Compare with{" "}
            <select aria-label="Compare with" value={second ?? ""} onChange={(e) => pickSecond((e.target.value || null) as TrendMetric | null)}>
              <option value="">None</option>
              {TREND_METRICS.filter((m) => m.key !== metric).map((m) => (
                <option key={m.key} value={m.key}>{m.key === "water" ? "Water (cups)" : m.label}</option>
              ))}
            </select>
          </label>
          {right && <YAxisControls key={second} label="Right axis" value={secondAxis} onChange={setSecondAxis} bounds={right.bounds} goal={null} showGoal={false} onShowGoal={() => {}} />}
          <TrendChart
            points={points}
            bounds={bounds}
            showMin={bounds.min !== 0}
            goal={goalLine}
            label={`${info.label}${secondInfo && right ? ` and ${secondInfo.label}` : ""}, ${lower}`}
            second={right && { points: right.points, bounds: right.bounds, showMin: right.bounds.min !== 0 }}
            secondName={secondInfo?.label}
          />
          {right && secondInfo && (
            <ul className="trend-key" aria-label="Legend">
              <li><span className="trend-swatch" aria-hidden="true" />{info.label} (left axis)</li>
              <li className="trend-second"><span className="trend-swatch" aria-hidden="true" />{secondInfo.label} (right axis)</li>
            </ul>
          )}
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
