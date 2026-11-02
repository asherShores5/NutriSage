// Meal windows (ticket 07). Per Member, under MEMBER#<username> / MEAL_WINDOWS (its own row, so a
// goals write never touches it). Schema: schema/mealWindows.graphql; logic: shared/src/mealWindows.ts.
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DEFAULT_MEAL_WINDOWS, validateMealWindows, type MealWindows } from "@nutrisage/shared";
import { invalid } from "../errors";
import { MEAL_WINDOWS_SK, TABLE, ddb, memberPk } from "../table";
import type { ResolverModule } from "./types";

/** A stored record; the defaults if there is none (or it no longer validates). */
function windowsOut(rec: Record<string, unknown> | undefined): MealWindows {
  const r = validateMealWindows(rec);
  return r.ok ? r.windows : { ...DEFAULT_MEAL_WINDOWS };
}

export const mealWindows: ResolverModule = {
  Query: {
    /** The caller's Meal windows; the defaults until they set some. */
    async mealWindows(ctx) {
      const r = await ddb().send(new GetCommand({ TableName: TABLE, Key: { PK: memberPk(ctx.username), SK: MEAL_WINDOWS_SK } }));
      return windowsOut(r.Item);
    },
  },
  Mutation: {
    /** Replace the caller's Meal windows: a start time for every Meal, all different. */
    async putMealWindows(ctx, { input }) {
      const r = validateMealWindows(input);
      if (!r.ok) throw invalid(r.error);
      await ddb().send(new PutCommand({ TableName: TABLE, Item: { PK: memberPk(ctx.username), SK: MEAL_WINDOWS_SK, ...r.windows, updatedAt: Date.now() } }));
      return r.windows;
    },
  },
};
