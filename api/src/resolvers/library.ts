// The shared Library: Foods and Recipes (tickets 12, 15, 19). HOUSEHOLD partition, so every
// Member reads and writes the same rows. Schema: schema/library.graphql.
//
// Ticket 12: the `library` query, and addEstimatedFood, which the Member estimate resolver calls so
// every estimated Food lands here (names deduplicated case-insensitively). Ticket 15: putFood (edit,
// either Member) and deleteFood (also removes every Member's Favorite of it). Ticket 17: Recipes at
// RECIPE#<id> and addRecipe (save to the Recipe Book). Ticket 19: putRecipe and deleteRecipe (like
// putFood/deleteFood), and a saved Recipe as an ingredient one level deep (nestingError, shared).
// Ticket 18: suggestYieldRatio (Bedrock fills in a Food's missing Yield ratio, for the Recipe
// builder) and ingredient estimates filling in a known Food's missing ratio. A ratio a Member typed
// (putFood) is never overwritten by a suggestion.
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  NUTRIENT_KEYS, checkRecipe, editedFood, nestingError, findFoodByName, foodFromServing, foodNameKey, type Food, type FoodEdit, type NewRecipe, type Recipe,
} from "@nutrisage/shared";
import { UserError, invalid } from "../errors";
import { estimateFood, type Estimate } from "../estimate";
import { HOUSEHOLD_PK, TABLE, ddb, favoriteKey, foodKey, memberPk, recipeKey, strip } from "../table";
import type { ResolverModule } from "./types";

/** Record cap against a scripted flood; far above what a household logs. Mutable for tests only. */
export const LIBRARY_LIMITS = { foods: 2000, recipes: 500 };

/** Every household row whose sort key starts with `prefix`. */
async function listHousehold<T>(prefix: string): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": HOUSEHOLD_PK, ":p": prefix },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).map((i) => strip<T>(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Every Food in the Library, in no particular order. */
export const listFoods = () => listHousehold<Food>(foodKey(""));

/** Every Recipe in the Recipe Book, in no particular order. */
export const listRecipes = async (): Promise<Recipe[]> =>
  (await listHousehold<Recipe>(recipeKey(""))).map((r) => ({ ...r, preparedGrams: r.preparedGrams ?? null }));

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
  if (existing) return est.yieldRatio ? fillYieldRatio(existing, est.yieldRatio) : existing;
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

const hasYieldRatio = (f: Food) => typeof f.yieldRatio === "number" && f.yieldRatio > 0;

const notFound = () => new UserError("NotFound", "That Food is no longer in the Library");

async function getFood(id: string): Promise<Food | undefined> {
  const r = await ddb().send(new GetCommand({ TableName: TABLE, Key: { PK: HOUSEHOLD_PK, SK: foodKey(id) } }));
  return r.Item ? strip<Food>(r.Item) : undefined;
}

/**
 * Give `food` the Yield ratio `ratio` unless it has one: a ratio already there (say a Member's edit
 * that landed meanwhile) is kept. Returns the Food as it now is.
 */
async function fillYieldRatio(food: Food, ratio: number): Promise<Food> {
  if (hasYieldRatio(food)) return food;
  try {
    const r = await ddb().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: HOUSEHOLD_PK, SK: foodKey(food.id) },
        UpdateExpression: "SET yieldRatio = :y, updatedAt = :t",
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(yieldRatio)",
        ExpressionAttributeValues: { ":y": ratio, ":t": Math.max(Date.now(), food.updatedAt) },
        ReturnValues: "ALL_NEW",
      }),
    );
    return strip<Food>(r.Attributes!);
  } catch (e) {
    if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
    const now = await getFood(food.id);
    if (!now) throw notFound();
    return now;
  }
}

/**
 * The Recipe builder's suggestion for a Library Food with no Yield ratio: ask Bedrock (as a recipe
 * ingredient) and save the ratio on the Food. A Food that has one, or a reply with no believable
 * ratio, is returned unchanged.
 */
async function suggestYieldRatio(id: string): Promise<Food> {
  const food = await getFood(id);
  if (!food) throw notFound();
  if (hasYieldRatio(food)) return food;
  const est = await estimateFood(food.name, { ingredient: true });
  return est.yieldRatio ? fillYieldRatio(food, est.yieldRatio) : food;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function foodId(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw invalid("bad Food id");
  return v;
}

function recipeId(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw invalid("bad Recipe id");
  return v;
}

/**
 * Save a new Recipe to the Recipe Book under the id the client chose (so the Entry logged from it
 * can point at it straight away). Saving an id that's already there returns that Recipe unchanged,
 * so a retry is harmless. Names are unique in the Recipe Book, ignoring case and spacing.
 */
async function addRecipe(username: string, id: string, input: unknown): Promise<Recipe> {
  const r = checkRecipe((input ?? {}) as NewRecipe);
  if (!r.ok) throw invalid(r.error);
  const all = await listRecipes();
  const existing = all.find((x) => x.id === id);
  if (existing) return existing;
  const nesting = nestingError({ id, ...r.recipe }, all);
  if (nesting) throw invalid(nesting);
  const clash = all.find((x) => foodNameKey(x.name) === foodNameKey(r.recipe.name));
  if (clash) throw invalid(`The Recipe Book already has ${clash.name}`);
  if (all.length >= LIBRARY_LIMITS.recipes) throw invalid("The Recipe Book is full");
  const recipe: Recipe = { id, ...r.recipe, createdBy: username, updatedAt: Date.now() };
  try {
    await ddb().send(
      new PutCommand({ TableName: TABLE, Item: { PK: HOUSEHOLD_PK, SK: recipeKey(id), ...recipe }, ConditionExpression: "attribute_not_exists(PK)" }),
    );
  } catch (e) {
    if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
    const now = (await listRecipes()).find((x) => x.id === id);
    if (now) return now;
    throw e;
  }
  return recipe;
}

const recipeGone = () => new UserError("NotFound", "That Recipe is no longer in the Recipe Book");

/**
 * Edit a saved Recipe (either Member): ingredients, name and Prepared weight. Its id and createdBy
 * stay; Entries logged from it keep their snapshot, and so do other Recipes that use it as an ingredient.
 */
async function putRecipe(id: string, input: unknown): Promise<Recipe> {
  const r = checkRecipe((input ?? {}) as NewRecipe);
  if (!r.ok) throw invalid(r.error);
  const all = await listRecipes();
  const existing = all.find((x) => x.id === id);
  if (!existing) throw recipeGone();
  const clash = all.find((x) => x.id !== id && foodNameKey(x.name) === foodNameKey(r.recipe.name));
  if (clash) throw invalid(`The Recipe Book already has ${clash.name}`);
  const nesting = nestingError({ id, ...r.recipe }, all);
  if (nesting) throw invalid(nesting);
  const recipe: Recipe = { id, ...r.recipe, createdBy: existing.createdBy, updatedAt: Math.max(Date.now(), existing.updatedAt) };
  try {
    // Only replace a Recipe that is still there, so an edit racing a delete doesn't bring it back.
    await ddb().send(new PutCommand({ TableName: TABLE, Item: { PK: HOUSEHOLD_PK, SK: recipeKey(id), ...recipe }, ConditionExpression: "attribute_exists(PK)" }));
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw recipeGone();
    throw e;
  }
  return recipe;
}

/** The GraphQL FoodEditInput as a FoodEdit; editedFood does the real checks. */
function asEdit(input: unknown): FoodEdit {
  const src = (input ?? {}) as Record<string, any>;
  if (!src.nutrition || typeof src.nutrition !== "object") throw invalid("nutrition is required");
  if (!Array.isArray(src.units)) throw invalid("units is required");
  return {
    name: typeof src.name === "string" ? src.name : "",
    nutrition: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, src.nutrition[k]])) as FoodEdit["nutrition"],
    servingGrams: src.servingGrams ?? null,
    units: src.units.map((u: any) => ({ label: typeof u?.label === "string" ? u.label : "", grams: u?.grams })),
    yieldRatio: src.yieldRatio ?? null,
  };
}

/** Edit a Food: any Member may. Its id and createdBy stay; Entries logged from it keep their snapshot. */
async function putFood(id: string, input: unknown): Promise<Food> {
  const r = editedFood(asEdit(input));
  if (!r.ok) throw invalid(r.error);
  const all = await listFoods();
  const existing = all.find((f) => f.id === id);
  if (!existing) throw new UserError("NotFound", "That Food is no longer in the Library");
  const clash = all.find((f) => f.id !== id && foodNameKey(f.name) === foodNameKey(r.food.name));
  if (clash) throw invalid(`The Library already has ${clash.name}`);
  const food: Food = { id, ...r.food, createdBy: existing.createdBy, updatedAt: Math.max(Date.now(), existing.updatedAt) };
  try {
    // Only replace a Food that is still there, so an edit racing a delete doesn't bring it back.
    await ddb().send(new PutCommand({ TableName: TABLE, Item: { PK: HOUSEHOLD_PK, SK: foodKey(id), ...food }, ConditionExpression: "attribute_exists(PK)" }));
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw new UserError("NotFound", "That Food is no longer in the Library");
    throw e;
  }
  return food;
}


/** Every Member's username (the handler's allowlist), read per call so tests can set it. */
const members = () => (process.env.ALLOWED_USERNAMES ?? "").split(",").filter(Boolean);

/**
 * Delete a Library item (Food or Recipe) and, in the same transaction, every Member's Favorite of it, so it drops out of
 * everyone's Quick Add. Entries keep their snapshot and their (now dangling) reference. Deleting
 * an item that's already gone succeeds, so a retry is harmless.
 */
async function deleteItem(id: string, sk: string): Promise<string> {
  const del = (PK: string, SK: string) => ({ Delete: { TableName: TABLE, Key: { PK, SK } } });
  await ddb().send(
    new TransactWriteCommand({
      TransactItems: [...members().map((u) => del(memberPk(u), favoriteKey(id))), del(HOUSEHOLD_PK, sk)],
    }),
  );
  return id;
}

const deleteFood = (id: string) => deleteItem(id, foodKey(id));

/** Delete a saved Recipe the same way: every Member's Favorite of it goes too; Entries and Recipes using it keep their snapshots. */
const deleteRecipe = (id: string) => deleteItem(id, recipeKey(id));

export const library: ResolverModule = {
  Query: {
    /** The whole shared Library; the same for every Member. */
    async library() {
      const [foods, recipes] = await Promise.all([listFoods(), listRecipes()]);
      return { foods, recipes };
    },
  },
  Mutation: {
    putFood: (_ctx, args) => putFood(foodId(args.id), args.input),
    deleteFood: (_ctx, args) => deleteFood(foodId(args.id)),
    suggestYieldRatio: (_ctx, args) => suggestYieldRatio(foodId(args.id)),
    addRecipe: (ctx, args) => addRecipe(ctx.username, recipeId(args.id), args.input),
    putRecipe: (_ctx, args) => putRecipe(recipeId(args.id), args.input),
    deleteRecipe: (_ctx, args) => deleteRecipe(recipeId(args.id)),
  },
};
