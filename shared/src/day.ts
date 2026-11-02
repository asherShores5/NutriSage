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
 * reference (libraryId, ticket 12) points at what it was logged from. Migrated Entries have no amount or unit: they count as
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
  /** The Library item (Food or Recipe) it was logged from, if any. Only a pointer: the snapshot above is what counts. */
  libraryId?: string | null;
  /** A Recipe Entry's ingredient breakdown for this portion (ticket 17), snapshotted like `nutrition`. */
  ingredients?: EntryIngredient[] | null;
}

/** One ingredient of a logged Recipe portion: its share of what went in (shown when the Entry is expanded). */
export interface EntryIngredient {
  name: string;
  nutrition: Nutrition;
  grams?: number | null;
  amount?: number | null;
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

/**
 * A Day changed on this device from `base` (the server's copy it started from, or undefined when it
 * started without one, e.g. opened offline), merged with the server's copy as it is now, so neither
 * device loses what it logged (spec: Offline). A three-way merge: Entries added on either side stay
 * (the server's first); Entries deleted on either side go; an Entry changed on one side keeps that
 * change (this device's when both changed it). Water and weight are this device's when it changed
 * them, else the server's.
 */
export function mergeDays(local: Day, server: Day | undefined, base: Day | undefined): Day {
  if (!server) return local;
  const was = new Map((base?.entries ?? []).map((e) => [e.id, JSON.stringify(e)]));
  const mine = new Map(local.entries.map((e) => [e.id, e]));
  const onServer = new Set(server.entries.map((e) => e.id));
  const changedHere = (e: Entry) => was.get(e.id) !== JSON.stringify(e);
  const entries = [
    ...server.entries.flatMap((s) => {
      const l = mine.get(s.id);
      if (!l) return was.has(s.id) ? [] : [s]; // deleted here, or new there
      return [changedHere(l) ? l : s];
    }),
    // Here but not on the server: new here, or deleted there (kept only if changed here since).
    ...local.entries.filter((l) => !onServer.has(l.id) && (!was.has(l.id) || changedHere(l))),
  ];
  const pick = <K extends "water" | "weight">(k: K) => ((local[k] ?? null) !== (base?.[k] ?? null) ? (local[k] ?? null) : (server[k] ?? null));
  return { ...local, entries, water: pick("water"), weight: pick("weight"), updatedAt: server.updatedAt };
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

/** Where an Entry moves: another Meal, another Day, or both. Leaving one out keeps it as is. */
export interface EntryMove {
  meal?: Meal;
  date?: string;
}

/**
 * Move an Entry to another Meal and/or Day (spec: moving changes only its Meal and/or Day; amount
 * and nutrition snapshot stay). Returns the Days to write: `[day]` for a Meal change on the same
 * Day, `[day, target]` for a Day change, `[]` if nothing changes. `target` is the destination Day
 * as stored (absent when that date has nothing logged); the Entry goes on its end.
 */
export function moveEntry(day: Day, entryId: string, to: EntryMove, target?: Day): Day[] {
  if (to.date !== undefined && !isDateKey(to.date)) throw new Error("date must be YYYY-MM-DD");
  const entry = day.entries.find((e) => e.id === entryId);
  if (!entry) return [];
  const moved: Entry = { ...entry, meal: to.meal ?? entry.meal };
  if (to.date === undefined || to.date === day.date) {
    if (moved.meal === entry.meal) return [];
    return [{ ...day, entries: day.entries.map((e) => (e.id === entryId ? moved : e)) }];
  }
  const dest = target ?? { date: to.date, entries: [], water: null, weight: null };
  return [
    { ...day, entries: day.entries.filter((e) => e.id !== entryId) },
    { ...dest, entries: [...dest.entries, moved] },
  ];
}

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const keyOf = (dt: Date) => dt.toISOString().slice(0, 10);

/** The date `delta` calendar days from `date` (both YYYY-MM-DD). Counted in UTC, so clock changes never skip a Day. */
export function shiftDate(date: string, delta: number): string {
  const dt = utc(date);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return keyOf(dt);
}

/** Header text for a Day: Today, Yesterday, Tomorrow, else e.g. "Wed, Oct 28" (with the year when it isn't this year). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  if (date === shiftDate(today, 1)) return "Tomorrow";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return utc(date).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The weight box's label for a Day: "Today's weight", "Yesterday's weight", else "Weight on Wed, Oct 28". */
export function weightLabel(date: string, today: string): string {
  const day = dayLabel(date, today);
  return ["Today", "Yesterday", "Tomorrow"].includes(day) ? `${day}'s weight` : `Weight on ${day}`;
}
