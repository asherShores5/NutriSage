// Trend series for the Trends tab (spec: Trend series). A pure function from Days, a metric and a
// date range to points; the chart only draws them. Unlogged Days are no data (never 0), segments
// across them are bridged, and today is in progress (ticket 20). Still to plug in: weekly buckets
// via TrendOptions (21), manual Y bounds and a goal line via YMode/trendBounds (22), and a second
// series with its own bounds (23: call trendSeries/trendSegments/trendBounds again per series).
import type { Day } from "./day";
import { NUTRIENTS, num, sumMacros, type NutrientKey } from "./nutrients";
import { datesBetween, isLogged, type DayLike, type DaysByDate } from "./week";

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

/** One date's value; null = no data (the line bridges it with a dashed segment). */
export interface TrendPoint {
  date: string;
  value: number | null;
  /** Today, still being logged: drawn so a half-logged Day doesn't read as a bad one. */
  inProgress: boolean;
}

/** Inclusive YYYY-MM-DD range. */
export interface TrendRange {
  from: string;
  to: string;
}

/**
 * One Day's value for a metric, or null when that Day has no data for it (an unlogged Day is
 * never 0, so lines don't dive to the floor). A nutrient needs at least one Entry and is the
 * Day's rounded total. Water is cups on a Day with water or Entries (a logged Day with no water
 * is a real 0). Weight needs a value > 0 (the old app wrote 0 for "not logged").
 */
export function trendValue(day: TrendDay | null | undefined, metric: TrendMetric): number | null {
  if (metric === "weight") return num(day?.weight) > 0 ? num(day?.weight) : null;
  if (metric === "water") return num(day?.water) > 0 || isLogged(day) ? num(day?.water) : null;
  return isLogged(day) ? Math.round(sumMacros(day?.entries)[metric]) : null;
}

/** How a series is built. Ticket 21 adds the bucket size (weekly averages over long ranges). */
export interface TrendOptions {
  /** Today's YYYY-MM-DD; its point is flagged in progress. */
  today?: string;
}

/** One point per date in `range`, oldest first. */
export function trendSeries(days: DaysByDate<TrendDay>, metric: TrendMetric, range: TrendRange, opts: TrendOptions = {}): TrendPoint[] {
  return datesBetween(range.from, range.to).map((date) => ({ date, value: trendValue(days[date], metric), inProgress: date === opts.today }));
}

/** A line segment between two points with data (indexes into the series). */
export interface TrendSegment {
  from: number;
  to: number;
  /** Crosses one or more no-data Days: drawn dashed so the gap stays visible. */
  bridged: boolean;
  /** Ends at today's in-progress point. */
  inProgress: boolean;
}

/** The line through a series: each point with data joins the next one with data. Works for any series (ticket 23's second metric too). */
export function trendSegments(points: readonly TrendPoint[]): TrendSegment[] {
  const out: TrendSegment[] = [];
  let prev = -1;
  points.forEach((p, i) => {
    if (p.value === null) return;
    if (prev >= 0) out.push({ from: prev, to: i, bridged: i - prev > 1, inProgress: p.inProgress });
    prev = i;
  });
  return out;
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

/** The caption's numbers: points with data, and the highest of them (null with none). */
export function trendSummary(points: readonly TrendPoint[]): { logged: number; max: number | null } {
  const present = points.map((p) => p.value).filter((v): v is number => v !== null);
  return { logged: present.length, max: present.length ? Math.max(...present) : null };
}
