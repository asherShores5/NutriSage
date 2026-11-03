// Favorites (Seam 2): per Member, a star on a Library item plus its last-used time.
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => {
  h.reset();
  // Two Foods in the shared Library to star.
  for (const id of ["eggs", "oats"]) h.db.seed({ PK: "HOUSEHOLD", SK: `FOOD#${id}`, id, name: id });
});

const NOW = Date.now();
const fav = (libraryId: string, lastUsed = NOW) => ({ input: { libraryId, lastUsed } });
const favorites = (member = h.A) => h.call(member, "favorites");

describe("Favorites are per Member", () => {
  it("a Member reads back the Favorites they put", async () => {
    expect(await h.call(h.A, "putFavorite", fav("eggs"))).toEqual({ libraryId: "eggs", lastUsed: NOW });
    await h.call(h.A, "putFavorite", fav("oats", NOW - 1000));
    expect(await favorites()).toEqual([{ libraryId: "eggs", lastUsed: NOW }, { libraryId: "oats", lastUsed: NOW - 1000 }]);
  });

  it("the other Member doesn't see them, and has their own", async () => {
    await h.call(h.A, "putFavorite", fav("eggs"));
    expect(await favorites(h.B)).toEqual([]);
    await h.call(h.B, "putFavorite", fav("oats"));
    expect((await favorites(h.A)).map((f: any) => f.libraryId)).toEqual(["eggs"]);
    expect((await favorites(h.B)).map((f: any) => f.libraryId)).toEqual(["oats"]);
  });

  it("deleting removes only the caller's Favorite", async () => {
    await h.call(h.A, "putFavorite", fav("eggs"));
    await h.call(h.B, "putFavorite", fav("eggs"));
    expect(await h.call(h.A, "deleteFavorite", { libraryId: "eggs" })).toBe("eggs");
    expect(await favorites(h.A)).toEqual([]);
    expect(await favorites(h.B)).toHaveLength(1);
  });

  it("are stored at MEMBER#<username> / FAV#<libraryId>", async () => {
    await h.call(h.A, "putFavorite", fav("eggs"));
    expect(h.db.dump().filter((r) => String(r.SK).startsWith("FAV#"))).toEqual([{ PK: "MEMBER#member-a", SK: "FAV#eggs", libraryId: "eggs", lastUsed: NOW }]);
  });

  it("are refused to an unknown username", async () => {
    await expect(h.call({ userId: "x", username: "stranger" }, "favorites")).rejects.toThrow("Forbidden");
  });
});

describe("putting a Favorite", () => {
  it("refuses a bad Library id or last-used time, and writes nothing", async () => {
    const bad = [
      { libraryId: "", lastUsed: NOW }, { libraryId: "a b", lastUsed: NOW }, { libraryId: "x".repeat(65), lastUsed: NOW },
      { libraryId: "eggs", lastUsed: "1" }, { libraryId: "eggs", lastUsed: NaN }, { libraryId: "eggs", lastUsed: -1 },
      { libraryId: "eggs", lastUsed: NOW + 2 * 86_400_000 },
    ];
    for (const input of bad) await expect(h.call(h.A, "putFavorite", { input })).rejects.toThrow(/^ValidationError/);
    expect(await favorites()).toEqual([]);
  });

  it("refuses an item that isn't in the Library", async () => {
    await expect(h.call(h.A, "putFavorite", fav("gone"))).rejects.toThrow(/^NotFound/);
    expect(await favorites()).toEqual([]);
  });

  it("a later last-used time bumps it; an older one arriving late (another device) keeps the newer", async () => {
    await h.call(h.A, "putFavorite", fav("eggs", NOW - 5000));
    expect(await h.call(h.A, "putFavorite", fav("eggs", NOW))).toEqual({ libraryId: "eggs", lastUsed: NOW });
    expect(await h.call(h.A, "putFavorite", fav("eggs", NOW - 1000))).toEqual({ libraryId: "eggs", lastUsed: NOW });
    expect(await favorites()).toEqual([{ libraryId: "eggs", lastUsed: NOW }]);
  });

  it("stops at the record cap, but a Favorite already starred can still be bumped", async () => {
    const { FAVORITE_LIMITS } = await import("./resolvers/favorites");
    const was = FAVORITE_LIMITS.favorites;
    FAVORITE_LIMITS.favorites = 1;
    try {
      await h.call(h.A, "putFavorite", fav("eggs", NOW - 1000));
      await expect(h.call(h.A, "putFavorite", fav("oats"))).rejects.toThrow(/^ValidationError: at most 1 Favorites/);
      expect(await h.call(h.A, "putFavorite", fav("eggs"))).toEqual({ libraryId: "eggs", lastUsed: NOW });
    } finally {
      FAVORITE_LIMITS.favorites = was;
    }
  });
});

describe("deleting a Library item", () => {
  it("drops it from every Member's Favorites and leaves their other Favorites", async () => {
    await h.call(h.A, "putFavorite", fav("eggs"));
    await h.call(h.A, "putFavorite", fav("oats"));
    await h.call(h.B, "putFavorite", fav("eggs"));
    await h.call(h.B, "deleteFood", { id: "eggs" });
    expect((await favorites(h.A)).map((f: any) => f.libraryId)).toEqual(["oats"]);
    expect(await favorites(h.B)).toEqual([]);
  });
});
