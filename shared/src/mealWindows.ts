// Meal windows (GLOSSARY.md, spec: Meal windows). Each Member sets a start time for every Meal; a
// Meal's window runs from its start until the next Meal starts, so the windows always cover the
// whole day with no gaps or overlaps. Before the earliest start, the Meal that started last the
// day before is still running (e.g. a 05:00 breakfast puts 01:00 in Dessert).
import { MEALS, MEAL_LABELS, type Meal } from "./day";

/** Start time ("HH:MM", 24-hour, device-local) of each Meal's window. */
export type MealWindows = Record<Meal, string>;

/** Breakfast before 10:30, Lunch 10:30-14:30, Snack 14:30-17:00, Dinner 17:00-20:30, Dessert from 20:30. */
export const DEFAULT_MEAL_WINDOWS: MealWindows = Object.freeze({
  breakfast: "00:00", lunch: "10:30", snack: "14:30", dinner: "17:00", dessert: "20:30",
}) as MealWindows;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A real 24-hour time written as HH:MM. */
export const isTimeOfDay = (s: unknown): s is string => typeof s === "string" && TIME.test(s);

/** Each Meal's window, earliest start first; `end` is the next Meal's start (the last wraps to the first). */
export function mealWindowRanges(windows: MealWindows): { meal: Meal; start: string; end: string }[] {
  const sorted = [...MEALS].sort((a, b) => minutes(windows[a]) - minutes(windows[b]));
  return sorted.map((meal, i) => ({ meal, start: windows[meal], end: windows[sorted[(i + 1) % sorted.length]] }));
}

/** The Meal whose window holds `now`'s local time of day. */
export function guessMeal(windows: MealWindows, now: Date): Meal {
  const t = now.getHours() * 60 + now.getMinutes();
  const ranges = mealWindowRanges(windows);
  let current = ranges[ranges.length - 1].meal;
  for (const r of ranges) if (minutes(r.start) <= t) current = r.meal;
  return current;
}

export type MealWindowsResult = { ok: true; windows: MealWindows } | { ok: false; error: string };

/** Check untrusted Meal windows (API input, form values): every Meal has an HH:MM start, all different. */
export function validateMealWindows(input: unknown): MealWindowsResult {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as MealWindows;
  for (const m of MEALS) {
    const v = src[m];
    if (!isTimeOfDay(v)) return { ok: false, error: `${MEAL_LABELS[m]} needs a start time (HH:MM)` };
    out[m] = v;
  }
  for (const [i, a] of MEALS.entries()) {
    const b = MEALS.slice(i + 1).find((x) => out[x] === out[a]);
    if (b) return { ok: false, error: `${MEAL_LABELS[a]} and ${MEAL_LABELS[b]} can't start at the same time` };
  }
  return { ok: true, windows: out };
}
