// One-time migration from the old app's us-east-1 table (ticket 16; spec: Migration and cutover).
// Old rows (lowercase pk/sk, one JSON `data` string) map into the v1 model:
//   <user>/YYYY-MM-DD  -> MEMBER#<user>/DAY#date   snapshot Entries, water, weight (missing Meal = Snack)
//   <user>/goals       -> MEMBER#<user>/GOALS      waterGoal -> water (default 8)
//   <user>/favorites   -> HOUSEHOLD/FOOD#id + MEMBER#<user>/FAV#id
//   household/meals    -> HOUSEHOLD/FOOD#id        the old shared quick-add meals
// Only asher and aubyn move; Tommy (and anything unrecognized) is skipped and counted.
//
// Idempotent: every id and timestamp comes from the old data, so the same old rows always plan the
// same items. A write only creates (attribute_not_exists): an item that is already there unchanged
// is left alone, and one that differs (e.g. edited in the new app since) is kept and reported,
// never overwritten. A dry run reads the target the same way and reports the same counts.
import { createHash } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import {
  DEFAULT_WATER_GOAL, MEALS, NUTRIENT_KEYS, SERVING, findFoodByName, foodFromServing, foodNameKey, isAmount, isDateKey, num,
  type Day, type Entry, type Favorite, type Food, type Goals, type Meal, type Nutrition,
} from "@nutrisage/shared";
import { DAY_LIMITS, validateDayInput } from "../resolvers/days";
import { validateGoals } from "../resolvers/goals";
import { GOALS_SK, HOUSEHOLD_PK, dayKey, favoriteKey, foodKey, memberPk, type DocClient } from "../table";

/** The Members whose data moves (spec: Tommy's data is not migrated). */
export const MIGRATED_MEMBERS = ["asher", "aubyn"] as const;

/** Fixed write time for migrated goals and Foods, so re-runs plan identical items. */
export const MIGRATED_AT = Date.UTC(2026, 10, 2);
/** Never-logged Favorites sit below every logged one in Quick Add, in the old list's order. */
const UNLOGGED_FAVORITE_AT = Date.UTC(2026, 0, 1);

/** The old app baked a portion into the name: "eggs (×2)" with nutrition already scaled. */
const PORTION = /^(.*) \(×([0-9.]+)\)$/;

export type Kind = "Day" | "Goals" | "Food" | "Favorite";
export const KINDS: readonly Kind[] = ["Day", "Goals", "Food", "Favorite"];

export interface PlannedItem {
  kind: Kind;
  item: Record<string, unknown> & { PK: string; SK: string };
}

export type Outcome = "create" | "unchanged" | "differs";
export interface Report {
  apply: boolean;
  counts: Record<Kind, Record<Outcome, number>>;
  /** Entries inside the planned Days. */
  entries: number;
  /** Old rows not migrated, by old pk. */
  skipped: Record<string, number>;
  /** Items already in the target that differ from the plan (kept as they are), as PK/SK. */
  differing: string[];
  /** Old Library items folded into a Food that was already in the new Library, by name. */
  reused: string[];
  /** Entries with a nutrient past the API's limit, written exactly as they are (see `outliersOf`). */
  outliers: string[];
}

type OldLibItem = { name?: unknown; macros?: unknown };
type Raw = Record<string, AttributeValue> | Record<string, unknown>;

const isMember = (u: string): u is (typeof MIGRATED_MEMBERS)[number] => (MIGRATED_MEMBERS as readonly string[]).includes(u);
const shortHash = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);

/**
 * Old macros as a complete Nutrition, exactly as logged: missing or junk values are 0 (older rows
 * lack fiber, sodium, iron). Nothing is capped; a value past the API's limit is kept and reported
 * (see `outliersOf`).
 */
function nutritionOf(macros: unknown): Nutrition {
  const src = (macros && typeof macros === "object" ? macros : {}) as Record<string, unknown>;
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, Math.max(0, num(src[k]))])) as Nutrition;
}

/** "<user> <date> <name>: <nutrient> <value>, ..." for each Entry with a nutrient past the API's limit. */
function outliersOf(user: string, day: Day): string[] {
  return day.entries.flatMap((e) => {
    const over = NUTRIENT_KEYS.filter((k) => e.nutrition[k] > DAY_LIMITS.nutrient);
    return over.length ? [`${user} ${day.date} ${e.name}: ${over.map((k) => `${k} ${e.nutrition[k]}`).join(", ")}`] : [];
  });
}

/** The Day with nutrients capped at the API's limit, only to run the API's other checks on it. */
function withinNutrientLimit(item: Record<string, unknown>): Record<string, unknown> {
  const cap = (n: Nutrition) => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, Math.min(DAY_LIMITS.nutrient, n[k])])) as Nutrition;
  const entries = (item.entries as Entry[]).map((e) => ({ ...e, nutrition: cap(e.nutrition) }));
  return { ...item, entries };
}

function cleanName(v: unknown, fallback = "Unnamed"): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return (s || fallback).slice(0, DAY_LIMITS.nameLength);
}

/** One old Entry as a snapshot Entry: same nutrition, its Meal (Snack if none), "(×N)" read into an amount of servings. */
function entryOf(old: Record<string, unknown>, id: string): Entry {
  const meal: Meal = MEALS.includes(old.meal as Meal) ? (old.meal as Meal) : "snack";
  const raw = typeof old.food === "string" ? old.food.trim() : "";
  const m = PORTION.exec(raw);
  const amount = m ? Number(m[2]) : NaN;
  const portioned = !!m && m[1].trim() !== "" && isAmount(amount, SERVING);
  return {
    id, meal,
    name: cleanName(portioned ? m![1] : raw),
    nutrition: nutritionOf(old.macros),
    ...(portioned ? { amount, unit: SERVING } : {}),
  };
}

function dayOf(user: string, date: string, data: Record<string, unknown>): Day {
  const entries = (Array.isArray(data.entries) ? data.entries : []).map((e, i) => entryOf((e ?? {}) as Record<string, unknown>, `m${shortHash(user, date, String(i))}`));
  const water = Math.round(num(data.water));
  const weight = num(data.weight);
  const at = Date.parse(String(data.updatedAt));
  return {
    date, entries,
    water: Math.min(DAY_LIMITS.water, Math.max(0, water)),
    weight: weight > 0 && weight <= DAY_LIMITS.weight ? weight : null,
    updatedAt: Number.isFinite(at) ? at : MIGRATED_AT,
  };
}

function goalsOf(data: Record<string, unknown>): Goals {
  const n = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, Math.max(0, num(data[k]))])) as Nutrition;
  return { ...n, water: data.waterGoal === undefined || data.waterGoal === null ? DEFAULT_WATER_GOAL : Math.max(0, num(data.waterGoal)) };
}

/** Old rows (DynamoDB JSON from a Scan, or already plain) as { pk, sk, data }. */
function readRow(raw: Raw): { pk: string; sk: string; data: Record<string, unknown> | null } {
  const looksMarshalled = raw.pk && typeof raw.pk === "object";
  const r = (looksMarshalled ? unmarshall(raw as Record<string, AttributeValue>) : raw) as Record<string, unknown>;
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    data = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    data = null;
  }
  return { pk: String(r.pk ?? ""), sk: String(r.sk ?? ""), data };
}

export interface Plan {
  items: PlannedItem[];
  entries: number;
  skipped: Record<string, number>;
  /** Old Library items folded into an existing new-Library Food. */
  reused: string[];
  outliers: string[];
}

/**
 * Map the old rows to the new items. `existingFoods` is the new Library as it stands, so an old
 * Favorite or quick-add meal whose name is already there (ignoring case) points at that Food
 * instead of adding a twin.
 */
export function planMigration(rows: readonly Raw[], existingFoods: readonly Food[] = []): Plan {
  const items: PlannedItem[] = [];
  const skipped: Record<string, number> = {};
  const reused: string[] = [];
  const skip = (pk: string) => (skipped[pk || "(blank)"] = (skipped[pk || "(blank)"] ?? 0) + 1);
  const days: { user: string; day: Day }[] = [];
  const favLists: { user: string; list: OldLibItem[] }[] = [];
  let household: OldLibItem[] = [];

  for (const raw of rows) {
    const { pk, sk, data } = readRow(raw);
    if (!data) { skip(pk); continue; }
    if (pk === "household" && sk === "meals") { household = Array.isArray(data.library) ? data.library : []; continue; }
    if (!isMember(pk)) { skip(pk); continue; }
    if (isDateKey(sk)) days.push({ user: pk, day: dayOf(pk, sk, data) });
    else if (sk === "goals") items.push({ kind: "Goals", item: { PK: memberPk(pk), SK: GOALS_SK, ...goalsOf(data), updatedAt: MIGRATED_AT } });
    else if (sk === "favorites") favLists.push({ user: pk, list: Array.isArray(data.favorites) ? data.favorites : [] });
    else skip(pk);
  }

  // Foods: old Favorites first (asher then aubyn), then the household meals; first name wins.
  favLists.sort((a, b) => MIGRATED_MEMBERS.indexOf(a.user as never) - MIGRATED_MEMBERS.indexOf(b.user as never));
  const planned: Food[] = [];
  const foodFor = (lib: OldLibItem, createdBy: string): Food | null => {
    const name = cleanName(lib?.name, "");
    if (!name) return null;
    const id = `m${shortHash("food", foodNameKey(name))}`;
    // A Food of this name saved in the new app (not by an earlier run of this script) is reused.
    const there = findFoodByName(existingFoods, name);
    if (there && there.id !== id) {
      if (!reused.includes(there.name)) reused.push(there.name);
      return there;
    }
    const mine = findFoodByName(planned, name);
    if (mine) return mine;
    const food: Food = {
      id,
      ...foodFromServing({ name, nutrition: nutritionOf(lib.macros), servingGrams: null }),
      createdBy, updatedAt: MIGRATED_AT,
    };
    planned.push(food);
    items.push({ kind: "Food", item: { PK: HOUSEHOLD_PK, SK: foodKey(food.id), ...food } });
    return food;
  };

  for (const { user, list } of favLists) {
    // Quick Add order: last logged first; never-logged ones below, in the old list's order (newest first).
    const lastLogged = new Map<string, number>();
    for (const d of days) {
      if (d.user !== user) continue;
      for (const e of d.day.entries) {
        const k = foodNameKey(e.name);
        lastLogged.set(k, Math.max(lastLogged.get(k) ?? 0, d.day.updatedAt ?? 0));
      }
    }
    const seen = new Set<string>();
    list.forEach((lib, i) => {
      const food = foodFor(lib, user);
      if (!food || seen.has(food.id)) return;
      seen.add(food.id);
      const fav: Favorite = { libraryId: food.id, lastUsed: lastLogged.get(foodNameKey(cleanName(lib.name))) ?? UNLOGGED_FAVORITE_AT - i };
      items.push({ kind: "Favorite", item: { PK: memberPk(user), SK: favoriteKey(food.id), ...fav } });
    });
  }
  for (const lib of household) foodFor(lib, MIGRATED_MEMBERS[0]);

  let entries = 0;
  const outliers: string[] = [];
  for (const { user, day } of days) {
    entries += day.entries.length;
    outliers.push(...outliersOf(user, day));
    items.push({ kind: "Day", item: { PK: memberPk(user), SK: dayKey(day.date), ...day } });
  }
  return { items, entries, skipped, reused, outliers };
}

/**
 * Every planned Day and goals record must pass the API's own checks before anything is written,
 * except the nutrient ceiling: old nutrition is kept exactly (spec: snapshots), so a value past it
 * is written outside resolver validation and listed in the report instead.
 */
function checkValid(items: readonly PlannedItem[]) {
  for (const { kind, item } of items) {
    try {
      if (kind === "Day") validateDayInput(withinNutrientLimit(item));
      if (kind === "Goals") validateGoals(item);
    } catch (e) {
      throw new Error(`${item.PK}/${item.SK} would be refused by the API: ${(e as Error).message}`);
    }
  }
}

/** Stable JSON for comparing a planned item with a stored one (key order doesn't matter). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as any)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

async function libraryFoods(db: DocClient, table: string): Promise<Food[]> {
  const out: Food[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await db.send(new QueryCommand({
      TableName: table, KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: { ":pk": HOUSEHOLD_PK, ":p": foodKey("") }, ExclusiveStartKey,
    }));
    out.push(...((r.Items ?? []) as Food[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export interface Target {
  db: DocClient;
  table: string;
}

/**
 * Plan the old rows against the target and, with `apply`, create what's missing. Foods go first,
 * then Favorites (which point at them), goals and Days. Without `apply` nothing is written.
 */
export async function migrate(rows: readonly Raw[], target: Target, opts: { apply: boolean }): Promise<Report> {
  const { db, table } = target;
  const plan = planMigration(rows, await libraryFoods(db, table));
  checkValid(plan.items);
  const counts = Object.fromEntries(KINDS.map((k) => [k, { create: 0, unchanged: 0, differs: 0 }])) as Report["counts"];
  const differing: string[] = [];
  const order = (k: Kind) => ["Food", "Favorite", "Goals", "Day"].indexOf(k);
  for (const { kind, item } of [...plan.items].sort((a, b) => order(a.kind) - order(b.kind))) {
    const stored = (await db.send(new GetCommand({ TableName: table, Key: { PK: item.PK, SK: item.SK } }))).Item;
    if (stored) {
      const same = canonical(stored) === canonical(item);
      counts[kind][same ? "unchanged" : "differs"]++;
      if (!same) differing.push(`${item.PK}/${item.SK}`);
      continue;
    }
    counts[kind].create++;
    if (opts.apply) {
      await db.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
    }
  }
  return { apply: opts.apply, counts, entries: plan.entries, skipped: plan.skipped, differing, reused: plan.reused, outliers: plan.outliers };
}

/** The report as printed by the script: the same table for a dry run and a real run. */
export function formatReport(r: Report): string {
  const verb = r.apply ? "created" : "would create";
  const lines = [
    r.apply ? "APPLIED" : "DRY RUN (nothing written; pass --apply to write)",
    `kind      ${verb.padEnd(13)} unchanged  differs (kept)`,
    ...KINDS.map((k) => `${k.padEnd(9)} ${String(r.counts[k].create).padEnd(13)} ${String(r.counts[k].unchanged).padEnd(10)} ${r.counts[k].differs}`),
    `Entries in migrated Days: ${r.entries}`,
    `Skipped old rows: ${Object.entries(r.skipped).map(([pk, n]) => `${pk} ${n}`).join(", ") || "none"}`,
  ];
  if (r.outliers.length) lines.push(`Over the API's limits (written as they are): ${r.outliers.join("; ")}`);
  if (r.reused.length) lines.push(`Old Library items matched to Foods already in the Library: ${r.reused.join(", ")}`);
  if (r.differing.length) lines.push(`Already in the table but different (left as they are):`, ...r.differing.map((d) => `  ${d}`));
  return lines.join("\n");
}
