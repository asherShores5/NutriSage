// Trend series for the Trends tab (spec: Trend series). A pure function from Days, a metric and a
// date range to points; the chart only draws them. Unlogged Days are no data (never 0), segments
// across them are bridged, and today is in progress (ticket 20). Long ranges are weekly averages
// via TrendOptions.bucket (21). Still to plug in: manual Y bounds and a goal line via YMode/trendBounds
// (22), and a second series with its own bounds (23: call trendSeries/trendSegments/trendBounds again per series).
import { isDateKey, type Day } from "./day";
import { NUTRIENTS, num, sumMacros, type NutrientKey } from "./nutrients";
import { datesBetween, isLogged, lastDays, type DayLike, type DaysByDate } from "./week";

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

/** One date's (or one weekly bucket's) value; null = no data (the line bridges it with a dashed segment). */
export interface TrendPoint {
  /** The Day, or a weekly bucket's first Day. */
  date: string;
  /** A weekly bucket's last Day (absent on daily points). */
  end?: string;
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

/** One point per Day, or per 7 Days (weekly averages, for long ranges: see trendBucket). */
export type TrendBucket = "day" | "week";

/** How a series is built. */
export interface TrendOptions {
  /** Today's YYYY-MM-DD; its point (or the weekly bucket holding it) is flagged in progress. */
  today?: string;
  /** Default "day". */
  bucket?: TrendBucket;
}

/**
 * Points for `range`, oldest first: one per date, or with bucket "week" one per 7 Days counted
 * back from `range.to` (so the newest bucket ends at the range's end; the oldest may be shorter).
 * A weekly point averages the Days with data in it (unlogged Days are never counted as 0), to one
 * decimal, and is null when none has data.
 */
export function trendSeries(days: DaysByDate<TrendDay>, metric: TrendMetric, range: TrendRange, opts: TrendOptions = {}): TrendPoint[] {
  const dates = datesBetween(range.from, range.to);
  const daily = dates.map((date) => ({ date, value: trendValue(days[date], metric), inProgress: date === opts.today }));
  if (opts.bucket !== "week") return daily;
  const out: TrendPoint[] = [];
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end);
    const vals = chunk.map((p) => p.value).filter((v): v is number => v !== null);
    out.unshift({
      date: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      value: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
      inProgress: chunk.some((p) => p.inProgress),
    });
  }
  return out;
}

/** Ranges longer than this many Days plot weekly averages (spec: "over about 90 days"). */
export const TREND_DAILY_MAX = 90;

/** Daily up to TREND_DAILY_MAX Days, weekly beyond (a year stays readable). */
export function trendBucket(range: TrendRange): TrendBucket {
  return datesBetween(range.from, range.to).length > TREND_DAILY_MAX ? "week" : "day";
}

export type TrendPreset = "7d" | "30d" | "90d" | "1y" | "all";

/** The range presets, in control order. `days` is the length ending today (All has none). */
export const TREND_PRESETS: readonly { key: TrendPreset; label: string; days?: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "1y", label: "Last year", days: 365 },
  { key: "all", label: "All time" },
];

/** Where an All query starts: before any Day could be logged, so one range query returns them all. */
export const TREND_ALL_FROM = "2000-01-01";

/**
 * A preset's range, ending today. All starts at `firstDay` (the oldest Day returned by a query
 * from TREND_ALL_FROM), or is just today when nothing is logged.
 */
export function presetRange(preset: TrendPreset, today: string, firstDay?: string): TrendRange {
  const n = TREND_PRESETS.find((p) => p.key === preset)?.days;
  if (n) return { from: lastDays(today, n)[0], to: today };
  return { from: firstDay && firstDay < today ? firstDay : today, to: today };
}

/** A custom start and end (YYYY-MM-DD, from date inputs), or why it can't be used. */
export function customRange(from: string, to: string, today: string): TrendRange | { error: string } {
  if (!isDateKey(from) || !isDateKey(to)) return { error: "Pick a start and an end." };
  if (from > to) return { error: "Start must be on or before end." };
  if (to > today) return { error: "End can't be after today." };
  return { from, to };
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
