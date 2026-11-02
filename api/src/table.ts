// Table layout (spec: Data). One table, keys PK/SK:
//   MEMBER#<username> / DAY#YYYY-MM-DD   one Member's Day
//   MEMBER#<username> / GOALS, MEAL_WINDOWS, FAV#<id>  that Member's goals, Meal windows, Favorites (later tickets)
//   HOUSEHOLD         / FOOD#<id>, RECIPE#<id>   the shared Library (Foods: ticket 12; Recipes: ticket 17)
// Partitions are keyed by Cognito username: Members are admin-created and allowlisted, and the
// username is what the migration (ticket 16) knows the old data by.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME!;

export const memberPk = (username: string) => `MEMBER#${username}`;
export const HOUSEHOLD_PK = "HOUSEHOLD";
export const dayKey = (date: string) => `DAY#${date}`;
export const foodKey = (id: string) => `FOOD#${id}`;
export const recipeKey = (id: string) => `RECIPE#${id}`;
export const GOALS_SK = "GOALS";
export const MEAL_WINDOWS_SK = "MEAL_WINDOWS";

export type DocClient = Pick<DynamoDBDocumentClient, "send">;

let client: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** The document client every resolver uses. */
export const ddb = (): DocClient => client;

/** Test seam: swap the document client (see testing/harness.ts). Production never calls this. */
export function setDocClient(c: DocClient) {
  client = c;
}

/** Drop the key attributes before a record goes back to the client. */
export function strip<T>(rec: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, ...rest } = rec;
  return rest as T;
}
