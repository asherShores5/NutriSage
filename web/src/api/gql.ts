// One GraphQL call to the Member API with the signed-in Member's ID token.
import { freshTokens } from "../auth";
import { getConfig } from "../config";

export async function gql<T = any>(query: string, variables: object = {}): Promise<T> {
  const { idToken } = await freshTokens();
  const r = await fetch(getConfig().graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: idToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json().catch(() => ({}));
  if (json.errors?.length) throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  if (!r.ok) throw new Error(`server ${r.status}`);
  return json.data as T;
}

/** GraphQL selection for a Nutrition object (every tracked nutrient). */
export const NUTRITION = `carbs protein fat fiber sodium iron calories`;
