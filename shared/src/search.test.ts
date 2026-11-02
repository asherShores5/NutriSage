import { describe, expect, it } from "vitest";
import { enterMatch, searchLibrary } from "./search";

const item = (id: string, name: string) => ({ id, name });
const LIBRARY = [
  item("cb", "Chicken breast"),
  item("ct", "Chicken thigh"),
  item("bk", "Banana"),
  item("eg", "2 eggs scrambled"),
  item("ap", "Apple pie"),
  item("gy", "Greek yogurt"),
  item("cp", "Chickpeas"),
];
const names = (query: string, opts?: Parameters<typeof searchLibrary>[2]) => searchLibrary(LIBRARY, query, opts).map((h) => h.item.name);

describe("searchLibrary (fuzzy search in the add box)", () => {
  it("matches partial words: 'chik brst' finds Chicken breast first", () => {
    expect(names("chik brst")[0]).toBe("Chicken breast");
    expect(names("chick")).toEqual(expect.arrayContaining(["Chicken breast", "Chicken thigh"]));
  });

  it("tolerates typos: a swapped, missing, extra or wrong letter", () => {
    expect(names("chikcen")[0]).toMatch(/^Chicken/); // swapped
    expect(names("bananna")[0]).toBe("Banana"); // extra
    expect(names("yoghurt")[0]).toBe("Greek yogurt"); // extra
    expect(names("grek")[0]).toBe("Greek yogurt"); // missing
    expect(names("chocken breast")[0]).toBe("Chicken breast"); // wrong
  });

  it("finds nothing for text that matches nothing well", () => {
    expect(names("xqzv")).toEqual([]);
    expect(names("pizza")).toEqual([]);
    expect(names("tofu")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });

  it("drops an item when only a stray letter or two line up", () => {
    // "pear" shares only letters with "apple pie" / "greek yogurt", and "cake" isn't "chicken"
    expect(names("pear")).toEqual([]);
    expect(names("cake")).toEqual([]);
  });

  it("drops an item that matches only one of several typed words", () => {
    expect(names("pad thai with chicken")).toEqual([]);
  });

  it("ignores a typed count that isn't part of the name: '2 bananas' finds Banana", () => {
    expect(names("2 bananas")).toEqual(["Banana"]);
    expect(names("2 eggs")[0]).toBe("2 eggs scrambled");
  });

  it("ranks my Favorites first among the matches", () => {
    expect(names("chicken", { favoriteIds: new Set(["ct"]) })).toEqual(["Chicken thigh", "Chicken breast"]);
    // even a weaker match: "chick" fits the shorter word "chicken" better, but Chickpeas is the Favorite
    expect(names("chick")).toEqual(["Chicken breast", "Chicken thigh", "Chickpeas"]);
    expect(names("chick", { favoriteIds: new Set(["cp"]) })).toEqual(["Chickpeas", "Chicken breast", "Chicken thigh"]);
  });

  it("never lets a Favorite in that doesn't match", () => {
    expect(names("banana", { favoriteIds: new Set(["cb"]) })).toEqual(["Banana"]);
  });

  it("returns at most `limit` hits", () => {
    expect(searchLibrary(LIBRARY, "c", { limit: 1 })).toHaveLength(1);
  });

  it("marks a hit whole when the text is the item's name, give or take case, spacing and a typo per word", () => {
    const top = (q: string) => searchLibrary(LIBRARY, q)[0];
    expect(top(" 2 Eggs  Scrambled ")).toMatchObject({ item: { id: "eg" }, whole: true });
    expect(top("chiken breast")).toMatchObject({ item: { id: "cb" }, whole: true });
    expect(top("chik brst")).toMatchObject({ item: { id: "cb" }, whole: false });
    expect(top("chicken")).toMatchObject({ whole: false });
    expect(top("banan")).toMatchObject({ item: { id: "bk" }, whole: false });
  });

  it("puts the item named exactly that above longer names holding the same word", () => {
    const rice = [item("fr", "Fried rice"), item("rb", "Rice and beans"), item("r", "Rice")];
    expect(searchLibrary(rice, "rice").map((h) => h.item.name)).toEqual(["Rice", "Fried rice", "Rice and beans"]);
  });
});

describe("enterMatch (what Enter logs in the add box)", () => {
  const enter = (q: string, opts?: Parameters<typeof searchLibrary>[2]) => enterMatch(searchLibrary(LIBRARY, q, opts))?.name;

  it("logs the top match when every word of its name was typed, typos and partial words allowed", () => {
    expect(enter("chik brst")).toBe("Chicken breast");
    expect(enter("chiken breast")).toBe("Chicken breast");
    expect(enter("Greek yoghurt")).toBe("Greek yogurt");
    expect(enter("eggs scrambled")).toBe("2 eggs scrambled"); // a count in the name or the text is the amount
    expect(enter("2 chik brst")).toBe("Chicken breast");
  });

  it("estimates instead when part of the name wasn't typed: 'apple' isn't Apple pie", () => {
    expect(enter("apple")).toBeUndefined();
    expect(enter("chicken")).toBeUndefined();
  });

  it("estimates when the text names more than the match: 'chicken breast sandwich'", () => {
    expect(enter("chicken breast sandwich")).toBeUndefined();
  });

  it("skips a starred match that doesn't cover the text for one below that does", () => {
    const lib = [item("ap", "Apple pie"), item("a", "Apple")];
    expect(enterMatch(searchLibrary(lib, "apple", { favoriteIds: new Set(["ap"]) }))?.name).toBe("Apple");
  });
});
