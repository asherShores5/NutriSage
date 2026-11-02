// Trend series for the Trends tab (spec: Trend series). A pure function from Days, a metric and a
// date range to points; the chart only draws them. Ticket 08 keeps the old 30-day chart's rules
// (ported from docs/script.js trendValue/drawChart, GitHub main 13e8f12). M4 extends this module:
// unlogged Days as no data + bridged flags and today in progress (20), weekly buckets (21),
// manual Y bounds and a goal line (22), a second series with its own bounds (23).
import type { Day } from "./day";
import { NUTRIENTS, num, sumMacros, type NutrientKey } from "./nutrients";
import { datesBetween, type DayLike, type DaysByDate } from "./week";

export type TrendMetric = NutrientKey | "weight" | "water";

export interface TrendMetricInfo {
  key: TrendMetric;
  label: string;
  unit: string;
}

const nutrient = (k: NutrientKey): TrendMetricInfo => {
  const n = NUTRIENTS.find((x) => x.key === k)!;
  return { key: n.key, label: n.label, unit: n.unit };
};

/** The metrics Trends can chart, in picker order (the old app's). */
export const TREND_METRICS: readonly TrendMetricInfo[] = [
  nutrient("calories"),
  { key: "weight", label: "Weight", unit: "" },
  { key: "water", label: "Water", unit: "cups" },
  ...(["carbs", "protein", "fat", "fiber", "sodium", "iron"] as const).map(nutrient),
];

/** What a trend reads from a Day: its Entries, water and weight. */
export type TrendDay = DayLike & Partial<Pick<Day, "water" | "weight">>;

/** One date's value; null = no point (a gap the line doesn't cross). */
export interface TrendPoint {
  date: string;
  value: number | null;
}

/** Inclusive YYYY-MM-DD range. */
export interface TrendRange {
  from: string;
  to: string;
}

/**
 * One Day's value for a metric. Weight is null unless > 0 (the old app wrote 0 for "not logged");
 * water is cups; a nutrient is the Day's total, rounded. A missing Day counts as empty.
 */
export function trendValue(day: TrendDay | null | undefined, metric: TrendMetric): number | null {
  if (metric === "weight") return num(day?.weight) > 0 ? num(day?.weight) : null;
  if (metric === "water") return num(day?.water);
  return Math.round(sumMacros(day?.entries)[metric]);
}

/** One point per date in `range`, oldest first. */
export function trendSeries(days: DaysByDate<TrendDay>, metric: TrendMetric, range: TrendRange): TrendPoint[] {
  return datesBetween(range.from, range.to).map((date) => ({ date, value: trendValue(days[date], metric) }));
}

/** How the Y-axis is scaled: from 0, or fit to the data's min..max. (Ticket 22 adds manual.) */
export type YMode = "zero" | "fit";

export interface YBounds {
  min: number;
  max: number;
}

/** The old chart's default: weight zooms to its range, everything else starts at 0. */
export function defaultYMode(metric: TrendMetric): YMode {
  return metric === "weight" ? "fit" : "zero";
}

/** Y-axis bounds for the points. The max is at least 1 so a flat-zero line still has an axis. */
export function trendBounds(points: readonly TrendPoint[], mode: YMode): YBounds {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (!vals.length) return { min: 0, max: 1 };
  const max = Math.max(1, ...vals);
  return { min: mode === "fit" ? Math.min(...vals) : 0, max };
}

/** The caption's numbers: points above 0, and the highest of them (null with none). */
export function trendSummary(points: readonly TrendPoint[]): { logged: number; max: number | null } {
  const present = points.map((p) => p.value).filter((v): v is number => v !== null && v > 0);
  return { logged: present.length, max: present.length ? Math.max(...present) : null };
}
