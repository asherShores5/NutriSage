import { describe, expect, it } from "vitest";
import { bumpFavorites, quickAdd, toggleFavorite, type Favorite } from "./favorites";

const item = (id: string) => ({ id, name: id });

describe("Quick Add", () => {
  it("lists a Member's Favorites most recently used first", () => {
    const favs: Favorite[] = [
      { libraryId: "oats", lastUsed: 100 },
      { libraryId: "eggs", lastUsed: 300 },
      { libraryId: "pear", lastUsed: 200 },
    ];
    expect(quickAdd(favs, [item("pear"), item("oats"), item("eggs"), item("rice")]).map((i) => i.id)).toEqual(["eggs", "pear", "oats"]);
  });

  it("leaves out a Favorite whose Library item is gone (deleted, or not loaded yet)", () => {
    const favs: Favorite[] = [{ libraryId: "gone", lastUsed: 900 }, { libraryId: "oats", lastUsed: 100 }];
    expect(quickAdd(favs, [item("oats")]).map((i) => i.id)).toEqual(["oats"]);
  });
});

describe("logging a starred item bumps it", () => {
  const favs: Favorite[] = [
    { libraryId: "eggs", lastUsed: 300 },
    { libraryId: "oats", lastUsed: 100 },
  ];

  it("to the top of Quick Add", () => {
    const { favorites, bumped } = bumpFavorites(favs, ["oats"], 500);
    expect(quickAdd(favorites, [item("eggs"), item("oats")]).map((i) => i.id)).toEqual(["oats", "eggs"]);
    expect(bumped).toEqual([{ libraryId: "oats", lastUsed: 500 }]);
  });

  it("but logging an item that isn't starred changes nothing", () => {
    const { favorites, bumped } = bumpFavorites(favs, ["rice", null, undefined], 500);
    expect(favorites).toEqual(favs);
    expect(bumped).toEqual([]);
  });

  it("and never moves a last-used time backwards (a clock behind the last log)", () => {
    const { favorites, bumped } = bumpFavorites(favs, ["eggs"], 200);
    expect(favorites).toEqual(favs);
    expect(bumped).toEqual([]);
  });
});

describe("starring", () => {
  const favs: Favorite[] = [{ libraryId: "eggs", lastUsed: 300 }];

  it("an unstarred item makes it a Favorite at the top of Quick Add", () => {
    const { favorites, change } = toggleFavorite(favs, "oats", 400);
    expect(quickAdd(favorites, [item("eggs"), item("oats")]).map((i) => i.id)).toEqual(["oats", "eggs"]);
    expect(change).toEqual({ type: "put", favorite: { libraryId: "oats", lastUsed: 400 } });
  });

  it("a starred item again removes the Favorite", () => {
    const { favorites, change } = toggleFavorite(favs, "eggs", 400);
    expect(favorites).toEqual([]);
    expect(change).toEqual({ type: "delete", libraryId: "eggs" });
  });
});
