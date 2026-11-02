// Day, Entry and Meal (GLOSSARY.md). A Day is one Member's log for one calendar date.
import type { Nutrition } from "./nutrients";

/** Display order (spec: Breakfast, Lunch, Dinner, Dessert, Snack). */
export const MEALS = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", dessert: "Dessert", snack: "Snack",
};

/**
 * An amount of one Food or Recipe logged into a Meal. `nutrition` is a snapshot taken at log time:
 * later Library edits never change it. Ticket 01 logs by hand (name + nutrition); ticket 02 adds
 * grams from a Bedrock estimate; ticket 05 adds amount and unit (see scaling.ts); the Library
 * reference arrives with a later ticket. Migrated Entries have no amount or unit: they count as
 * 1 serving of their snapshot.
 */
export interface Entry {
  id: string;
  meal: Meal;
  name: string;
  nutrition: Nutrition;
  /** Gram weight of what was logged, when known (e.g. the serving weight from an estimate). */
  grams?: number | null;
  /** How much was logged, in `unit` (more than 0, at most 100; 5000 in g). Absent means 1. */
  amount?: number | null;
  /** "serving", "g" or a Food's own unit label. Absent means "serving". */
  unit?: string | null;
}

/** One Member's Day. The whole Day is written at once (last write wins per Day). */
export interface Day {
  /** YYYY-MM-DD, the Member's local calendar date. */
  date: string;
  entries: Entry[];
  /** Cups of water (ticket 04). */
  water?: number | null;
  /** Once-per-Day weight (ticket 04). */
  weight?: number | null;
  /** Server time of the last write, epoch ms. */
  updatedAt?: number;
}

/** The Day's Entries grouped by Meal, in display order; Meals with no Entries are left out. */
export function entriesByMeal(entries: readonly Entry[]): [Meal, Entry[]][] {
  return MEALS.map((m) => [m, entries.filter((e) => e.meal === m)] as [Meal, Entry[]]).filter(([, list]) => list.length > 0);
}

/** YYYY-MM-DD for `d` in local time: the Day boundary is the Member's, not UTC. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A real calendar date written as YYYY-MM-DD. */
export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
