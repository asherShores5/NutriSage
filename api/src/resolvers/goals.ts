// Goals (ticket 04). Per Member, under MEMBER#<username> / GOALS.
// Schema: schema/goals.graphql.
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { NUTRIENT_KEYS, defaultGoals, num, type Goals } from "@nutrisage/shared";
import { invalid } from "../errors";
import { GOALS_SK, TABLE, ddb, memberPk } from "../table";
import type { ResolverModule } from "./types";

export const GOAL_LIMITS = { nutrient: 100_000, water: 100 } as const;

function inRange(v: unknown, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw invalid(`${what} goal must be a number from 0 to ${max}`);
  return v;
}

export function validateGoals(input: unknown): Goals {
  const src = (input ?? {}) as Record<string, unknown>;
  const out = defaultGoals();
  for (const k of NUTRIENT_KEYS) out[k] = inRange(src[k], GOAL_LIMITS.nutrient, k);
  out.water = inRange(src.water, GOAL_LIMITS.water, "water");
  return out;
}

/** A stored goals record, filled out with defaults for anything missing (e.g. migrated rows without water). */
function goalsOut(rec: Record<string, unknown> | undefined): Goals {
  const out = defaultGoals();
  if (!rec) return out;
  for (const k of NUTRIENT_KEYS) out[k] = num(rec[k]);
  if (rec.water !== undefined && rec.water !== null) out.water = num(rec.water);
  return out;
}

export const goals: ResolverModule = {
  Query: {
    /** The caller's goals; defaults (no nutrient goals, 8 cups of water) until they set some. */
    async goals(ctx) {
      const r = await ddb().send(new GetCommand({ TableName: TABLE, Key: { PK: memberPk(ctx.username), SK: GOALS_SK } }));
      return goalsOut(r.Item);
    },
  },
  Mutation: {
    /** Replace the caller's goals: every nutrient and water. */
    async putGoals(ctx, { input }) {
      const g = validateGoals(input);
      await ddb().send(new PutCommand({ TableName: TABLE, Item: { PK: memberPk(ctx.username), SK: GOALS_SK, ...g, updatedAt: Date.now() } }));
      return g;
    },
  },
};
