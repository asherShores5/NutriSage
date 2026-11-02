// Favorites and Quick Add (ticket 14). Per Member: one row per Favorite at
// MEMBER#<username> / FAV#<libraryId>, holding the Library item reference and its last-used time.
// Schema: schema/favorites.graphql. Quick Add order (newest lastUsed first) is shared/src/favorites.ts.
//
// Writes come from each device's outbox, possibly late (offline), so a put never moves lastUsed
// backwards: an older bump arriving after a newer one keeps the newer. Library delete (ticket 15)
// calls removeFavoritesOf so a deleted item drops out of everyone's Quick Add; the client also
// skips any Favorite whose item is gone (quickAdd in shared), so a stray orphan is harmless.
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Favorite } from "@nutrisage/shared";
import { UserError, invalid } from "../errors";
import { HOUSEHOLD_PK, TABLE, ddb, favoriteKey, foodKey, memberPk, strip } from "../table";
import type { ResolverModule } from "./types";

/** Record cap per Member against a scripted flood. Mutable for tests only. */
export const FAVORITE_LIMITS = { favorites: 500 };
/** Device clocks can run a little ahead; anything further out is refused. */
const MAX_AHEAD_MS = 86_400_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Library row prefixes a Favorite may point at (Recipes arrive with ticket 19). */
const LIBRARY_KEYS = [foodKey, (id: string) => `RECIPE#${id}`];

function validateFavorite(input: unknown): Favorite {
  const src = (input ?? {}) as Record<string, unknown>;
  if (typeof src.libraryId !== "string" || !ID_RE.test(src.libraryId)) throw invalid("bad Library reference");
  const t = src.lastUsed;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > Date.now() + MAX_AHEAD_MS) throw invalid("lastUsed must be a time, not in the future");
  return { libraryId: src.libraryId, lastUsed: t };
}

async function inLibrary(libraryId: string): Promise<boolean> {
  for (const key of LIBRARY_KEYS) {
    const r = await ddb().send(new GetCommand({ TableName: TABLE, Key: { PK: HOUSEHOLD_PK, SK: key(libraryId) } }));
    if (r.Item) return true;
  }
  return false;
}

async function countFavorites(username: string): Promise<number> {
  let n = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: TABLE, Select: "COUNT",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": memberPk(username), ":p": favoriteKey("") },
        ExclusiveStartKey,
      }),
    );
    n += r.Count ?? 0;
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return n;
}

/**
 * Remove one Library item from every Member's Favorites. Ticket 15 calls this when a Library item
 * is deleted. Members are the allowlist (ALLOWED_USERNAMES), read at call time.
 */
export async function removeFavoritesOf(libraryId: string): Promise<void> {
  const members = (process.env.ALLOWED_USERNAMES ?? "").split(",").filter(Boolean);
  await Promise.all(
    members.map((u) => ddb().send(new DeleteCommand({ TableName: TABLE, Key: { PK: memberPk(u), SK: favoriteKey(libraryId) } }))),
  );
}

/** Every Favorite of one Member, in no particular order. */
async function listFavorites(username: string): Promise<Favorite[]> {
  const out: Favorite[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": memberPk(username), ":p": favoriteKey("") },
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).map((i) => strip<Favorite>(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export const favorites: ResolverModule = {
  Query: {
    /** The caller's Favorites. */
    async favorites(ctx) {
      return listFavorites(ctx.username);
    },
  },
  Mutation: {
    /** Star a Library item for the caller, or record when they last logged it. */
    async putFavorite(ctx, { input }) {
      const fav = validateFavorite(input);
      const Key = { PK: memberPk(ctx.username), SK: favoriteKey(fav.libraryId) };
      const stored = (await ddb().send(new GetCommand({ TableName: TABLE, Key }))).Item;
      if (stored && Number(stored.lastUsed) >= fav.lastUsed) return strip<Favorite>(stored);
      if (!stored) {
        if (!(await inLibrary(fav.libraryId))) throw new UserError("NotFound", "That Library item no longer exists");
        if ((await countFavorites(ctx.username)) >= FAVORITE_LIMITS.favorites) throw invalid(`at most ${FAVORITE_LIMITS.favorites} Favorites`);
      }
      try {
        await ddb().send(
          new PutCommand({
            TableName: TABLE, Item: { ...Key, ...fav },
            ConditionExpression: "attribute_not_exists(PK) OR lastUsed < :t",
            ExpressionAttributeValues: { ":t": fav.lastUsed },
          }),
        );
      } catch (e) {
        if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
        // A newer bump landed in between: keep it.
        return strip<Favorite>((await ddb().send(new GetCommand({ TableName: TABLE, Key }))).Item!);
      }
      return fav;
    },
    /** Unstar a Library item for the caller. Returns its id. */
    async deleteFavorite(ctx, { libraryId }) {
      if (typeof libraryId !== "string" || !ID_RE.test(libraryId)) throw invalid("bad Library reference");
      await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { PK: memberPk(ctx.username), SK: favoriteKey(libraryId) } }));
      return libraryId;
    },
  },
};
