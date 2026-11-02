// Week tab logic (spec: "Kept as-is"): dates in a window, week totals and averages over logged Days,
// and the logging streak. Ported from the old docs/macros.js (GitHub main 13e8f12).
import type { Day } from "./day";
import type { Goals } from "./goals";
import { NUTRIENT_KEYS, emptyNutrition, num, sumMacros, type HasNutrition, type Nutrition } from "./nutrients";

/** Anything Day-shaped: only its Entries matter here. Old or partial data may lack them. */
export interface DayLike {
  entries?: readonly (HasNutrition | null | undefined)[] | null;
}

/** Days keyed by YYYY-MM-DD. A date that's absent was never logged. */
export type DaysByDate<D extends DayLike = DayLike> = Readonly<Record<string, D | undefined>>;

/** Index a list of Days (e.g. a `days` query result) by date. */
export function daysByDate<D extends Pick<Day, "date">>(days: readonly D[]): Record<string, D> {
  return Object.fromEntries(days.map((d) => [d.date, d]));
}

/** A logged Day has at least one Entry (water or weight alone doesn't count). */
export function isLogged(day: DayLike | null | undefined): boolean {
  return (day?.entries?.length ?? 0) > 0;
}

/** The `n` YYYY-MM-DD dates ending at (and including) `endKey`, oldest first. Calendar math only (no time zone or DST drift). */
export function lastDays(endKey: string, n: number): string[] {
  const [y, m, d] = endKey.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

/** Every YYYY-MM-DD date from `from` to `to` inclusive, oldest first (empty when from > to). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; ; i++) {
    const k = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (k > to) return out;
    out.push(k);
  }
}

/** The 7 dates ending at (and including) `endKey`, oldest first. */
export function weekKeys(endKey: string): string[] {
  return lastDays(endKey, 7);
}

/** Nutrient totals over the 7 Days ending at `endKey`. */
export function sumWeek(days: DaysByDate, endKey: string): Nutrition {
  const acc = emptyNutrition();
  for (const k of weekKeys(endKey)) {
    const t = sumMacros(days[k]?.entries);
    for (const n of NUTRIENT_KEYS) acc[n] += t[n];
  }
  return acc;
}

export interface WeekStats {
  /** Daily average over logged Days only (averaging in empty Days would mislead); 0 with none. */
  avg: Nutrition;
  /** The week's totals (shown against goal x7). */
  total: Nutrition;
  /** How many of the 7 Days are logged. */
  logged: number;
  days: 7;
}

/** The Week tab's numbers for the 7 Days ending at `endKey`. */
export function weekStats(days: DaysByDate, endKey: string): WeekStats {
  const logged = weekKeys(endKey).filter((k) => isLogged(days[k])).length;
  const total = sumWeek(days, endKey);
  const avg = emptyNutrition();
  for (const n of NUTRIENT_KEYS) avg[n] = logged ? total[n] / logged : 0;
  return { avg, total, logged, days: 7 };
}

/** The week total's targets: each nutrient goal x7 (0 stays "no goal"). */
export function weekGoals(goals: Partial<Goals> | null | undefined): Nutrition {
  const out = emptyNutrition();
  for (const n of NUTRIENT_KEYS) out[n] = Math.max(0, num(goals?.[n])) * 7;
  return out;
}

/** The day before a YYYY-MM-DD date. */
function dayBefore(key: string): string {
  return lastDays(key, 2)[0];
}

/**
 * Consecutive logged Days ending at `endKey`. Grace: an unlogged `endKey` (today, still in
 * progress) doesn't break the streak, so the count only drops once a whole Day is missed.
 */
export function streak(days: DaysByDate, endKey: string): number {
  let cur = isLogged(days[endKey]) ? endKey : dayBefore(endKey);
  let n = 0;
  while (isLogged(days[cur])) {
    n++;
    cur = dayBefore(cur);
  }
  return n;
}
