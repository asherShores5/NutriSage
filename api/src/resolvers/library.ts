// The shared Library: Foods and Recipes (tickets 12, 15, 19). HOUSEHOLD partition, so every
// Member reads and writes the same rows. Schema: schema/library.graphql.
//
// Ticket 12: the `library` query, and addEstimatedFood, which the Member estimate resolver calls so
// every estimated Food lands here (names deduplicated case-insensitively). Library edit (15) adds
// putFood/deleteFood here; Recipes (19) add a RECIPE# prefix and a `recipes` field on Library.
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { NUTRIENT_KEYS, findFoodByName, foodFromServing, type Food } from "@nutrisage/shared";
import type { Estimate } from "../estimate";
import { HOUSEHOLD_PK, TABLE, ddb, foodKey, strip } from "../table";
import type { ResolverModule } from "./types";

/** Record cap against a scripted flood; far above what a household logs. Mutable for tests only. */
export const LIBRARY_LIMITS = { foods: 2000 };

/** Every Food in the Library, in no particular order. */
export async function listFoods(): Promise<Food[]> {
  const out: Food[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": HOUSEHOLD_PK, ":p": foodKey("") },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).map((i) => strip<Food>(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * Save an estimate as a Library Food, per gram with its units, unless a Food with the same name
 * (ignoring case and spacing) is already there: then that Food is returned unchanged. Returns null,
 * saving nothing, for an all-zero (unrecognized) estimate or when the Library is full.
 * Two Members estimating the same new name at the same instant could both save it; harmless and rare.
 */
export async function addEstimatedFood(username: string, est: Estimate): Promise<Food | null> {
  if (NUTRIENT_KEYS.every((k) => !est.nutrition[k])) return null;
  const foods = await listFoods();
  const existing = findFoodByName(foods, est.name);
  if (existing) return existing;
  if (foods.length >= LIBRARY_LIMITS.foods) return null;
  const food: Food = {
    id: crypto.randomUUID(),
    ...foodFromServing({ name: est.name, nutrition: est.nutrition, servingGrams: est.servingGrams, units: est.units, yieldRatio: est.yieldRatio }),
    createdBy: username,
    updatedAt: Date.now(),
  };
  await ddb().send(
    new PutCommand({ TableName: TABLE, Item: { PK: HOUSEHOLD_PK, SK: foodKey(food.id), ...food }, ConditionExpression: "attribute_not_exists(PK)" }),
  );
  return food;
}

export const library: ResolverModule = {
  Query: {
    /** The whole shared Library; the same for every Member. */
    async library() {
      return { foods: await listFoods() };
    },
  },
  Mutation: {},
};
