// Days: a Member reads and writes only their own (spec: API contract). Schema: schema/days.graphql.
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { MEALS, NUTRIENT_KEYS, RECIPE_LIMITS, amountMax, isAmount, isDateKey, type Day, type Entry, type EntryIngredient, type Nutrition } from "@nutrisage/shared";
import { invalid } from "../errors";
import { TABLE, dayKey, ddb, memberPk, strip } from "../table";
import type { ResolverModule } from "./types";

/** Record caps against a scripted flood, generous enough that real logging never meets them. */
export const DAY_LIMITS = { entries: 200, nameLength: 120, nutrient: 100_000, water: 100, weight: 2_000, grams: 100_000, unitLength: 30 } as const;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function finiteIn(v: unknown, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw invalid(`${what} must be a number from 0 to ${max}`);
  return v;
}

function optionalIn(v: unknown, max: number, what: string): number | null {
  return v === null || v === undefined ? null : finiteIn(v, max, what);
}

function validateNutrition(n: unknown): Nutrition {
  if (!n || typeof n !== "object") throw invalid("nutrition is required");
  const src = n as Record<string, unknown>;
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, finiteIn(src[k], DAY_LIMITS.nutrient, k)])) as Nutrition;
}

function validateEntry(e: unknown): Entry {
  const src = (e ?? {}) as Record<string, unknown>;
  if (typeof src.id !== "string" || !ID_RE.test(src.id)) throw invalid("bad Entry id");
  if (!MEALS.includes(src.meal as never)) throw invalid("bad Meal");
  const name = typeof src.name === "string" ? src.name.trim() : "";
  if (!name || name.length > DAY_LIMITS.nameLength) throw invalid(`Entry name must be 1-${DAY_LIMITS.nameLength} characters`);
  const grams = optionalIn(src.grams, DAY_LIMITS.grams, "grams");
  const ref = src.libraryId;
  if (ref !== null && ref !== undefined && (typeof ref !== "string" || !ID_RE.test(ref))) throw invalid("bad Library reference");
  const ingredients = validateIngredients(src.ingredients);
  return {
    id: src.id, meal: src.meal as Entry["meal"], name, nutrition: validateNutrition(src.nutrition),
    ...(grams === null ? {} : { grams }), ...validateAmount(src), ...(typeof ref === "string" ? { libraryId: ref } : {}),
    ...(ingredients ? { ingredients } : {}),
  };
}

/**
 * A Recipe Entry's breakdown (ticket 17): a snapshot for display, so only names and numbers are
 * checked. Its amounts are shares of the Recipe's (e.g. 0.3 can), not logged amounts, so they
 * aren't held to the 100-unit limit.
 */
function validateIngredients(v: unknown): EntryIngredient[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw invalid("ingredients must be a list");
  if (v.length > RECIPE_LIMITS.ingredients) throw invalid(`at most ${RECIPE_LIMITS.ingredients} ingredients`);
  return v.map((i) => {
    const src = (i ?? {}) as Record<string, unknown>;
    const name = typeof src.name === "string" ? src.name.trim() : "";
    if (!name || name.length > DAY_LIMITS.nameLength) throw invalid(`ingredient name must be 1-${DAY_LIMITS.nameLength} characters`);
    const grams = optionalIn(src.grams, DAY_LIMITS.grams, "ingredient grams");
    const amount = optionalIn(src.amount, DAY_LIMITS.grams, "ingredient amount");
    const unit = src.unit === null || src.unit === undefined ? null : typeof src.unit === "string" ? src.unit.trim() : "";
    if (unit !== null && (!unit || unit.length > DAY_LIMITS.unitLength)) throw invalid(`ingredient unit must be 1-${DAY_LIMITS.unitLength} characters`);
    return {
      name, nutrition: validateNutrition(src.nutrition),
      ...(grams ? { grams } : {}), ...(amount ? { amount } : {}), ...(unit ? { unit } : {}),
    };
  });
}

/** Amount and unit come together, or neither (a migrated Entry, which counts as 1 serving). */
function validateAmount(src: Record<string, unknown>): Pick<Entry, "amount" | "unit"> {
  const none = (v: unknown) => v === null || v === undefined;
  if (none(src.amount) && none(src.unit)) return {};
  const unit = typeof src.unit === "string" ? src.unit.trim() : "";
  if (!unit || unit.length > DAY_LIMITS.unitLength) throw invalid(`unit must be 1-${DAY_LIMITS.unitLength} characters, with an amount`);
  if (!isAmount(src.amount, unit)) throw invalid(`amount must be more than 0 and at most ${amountMax(unit)}`);
  return { amount: src.amount, unit };
}

/** Whole cups, or null for none logged. */
function validateWater(v: unknown): number | null {
  const cups = optionalIn(v, DAY_LIMITS.water, "water");
  if (cups !== null && !Number.isInteger(cups)) throw invalid("water must be a whole number of cups");
  return cups;
}

/** Once-per-Day weight, more than 0, or null for not logged (the old app wrote 0 for that). */
function validateWeight(v: unknown): number | null {
  const w = optionalIn(v, DAY_LIMITS.weight, "weight");
  if (w === 0) throw invalid("weight must be more than 0; clear it instead");
  return w;
}

export function validateDayInput(input: unknown): Omit<Day, "updatedAt"> {
  const src = (input ?? {}) as Record<string, unknown>;
  if (!isDateKey(src.date)) throw invalid("date must be YYYY-MM-DD");
  if (!Array.isArray(src.entries)) throw invalid("entries is required");
  if (src.entries.length > DAY_LIMITS.entries) throw invalid(`at most ${DAY_LIMITS.entries} Entries per Day`);
  const entries = src.entries.map(validateEntry);
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw invalid("duplicate Entry id");
  return {
    date: src.date,
    entries,
    water: validateWater(src.water),
    weight: validateWeight(src.weight),
  };
}

const dayOut = (rec: Record<string, unknown>): Day => {
  const d = strip<Day>(rec);
  return { ...d, water: d.water ?? null, weight: d.weight ?? null };
};

export const days: ResolverModule = {
  Query: {
    /** The caller's Days from `from` to `to` inclusive, oldest first. Unlogged dates are absent. */
    async days(ctx, { from, to }) {
      if (!isDateKey(from) || !isDateKey(to) || from > to) throw invalid("from and to must be YYYY-MM-DD with from <= to");
      const out: Day[] = [];
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const r = await ddb().send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
            ExpressionAttributeValues: { ":pk": memberPk(ctx.username), ":a": dayKey(from), ":b": dayKey(to) },
            ExclusiveStartKey,
          }),
        );
        out.push(...(r.Items ?? []).map(dayOut));
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return out;
    },
  },
  Mutation: {
    /** Write the caller's whole Day (Entries, water, weight). Last write wins. */
    async putDay(ctx, { input }) {
      const d = { ...validateDayInput(input), updatedAt: Date.now() };
      await ddb().send(new PutCommand({ TableName: TABLE, Item: { PK: memberPk(ctx.username), SK: dayKey(d.date), ...d } }));
      return d;
    },
  },
};
