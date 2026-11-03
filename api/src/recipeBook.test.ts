// The Recipe Book (ticket 19, Seam 2): either Member edits or deletes any saved Recipe; a delete
// takes every Member's Favorite of it along; Entries logged from it never change. A Recipe can hold
// a saved Recipe as an ingredient one level deep; deeper is refused.
import { beforeEach, describe, expect, it } from "vitest";
import { emptyNutrition, ingredientFromRecipe, logRecipe, type NewRecipe, type Recipe, type RecipeIngredient } from "@nutrisage/shared";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const n = (calories: number) => ({ ...emptyNutrition(), calories });
const CHILI: NewRecipe = {
  name: "Chili",
  ingredients: [
    { libraryId: "beef", name: "Ground beef", amount: 500, unit: "g", grams: 500, nutrition: n(1250) },
    { libraryId: "beans", name: "Kidney beans", amount: 1, unit: "can", grams: 400, nutrition: n(360) },
  ],
  preparedGrams: 1200,
};
const TORTILLA: RecipeIngredient = { libraryId: "tort", name: "Tortilla", amount: 1, unit: "serving", grams: 60, nutrition: n(150) };

const save = (id: string, input: NewRecipe, member = h.A): Promise<Recipe> => h.call(member, "addRecipe", { id, input });
const recipes = async (member = h.A): Promise<Recipe[]> => (await h.call(member, "library")).recipes;
const asIngredient = (r: Recipe, amount: number, unit: string) => {
  const x = ingredientFromRecipe(r, { amount, unit });
  if (!x.ok) throw new Error(x.error);
  return x.ingredient;
};

describe("putRecipe (edit a saved Recipe)", () => {
  it("either Member edits the ingredients, name and Prepared weight; id and creator stay", async () => {
    const chili = await save("r1", CHILI, h.A);
    const edited = await h.call(h.B, "putRecipe", {
      id: "r1", input: { name: "Chili con carne", ingredients: [CHILI.ingredients[0]], preparedGrams: 800 },
    });
    expect(edited).toMatchObject({ id: "r1", name: "Chili con carne", createdBy: "member-a", preparedGrams: 800, ingredients: [CHILI.ingredients[0]] });
    expect(edited.updatedAt).toBeGreaterThanOrEqual(chili.updatedAt);
    expect(await recipes(h.A)).toEqual([edited]);
  });

  it("leaves Entries logged from the Recipe untouched", async () => {
    const chili = await save("r1", CHILI);
    const r = logRecipe(chili, { amount: 300, unit: "g" }, "dinner");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });
    const [before] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    await h.call(h.B, "putRecipe", { id: "r1", input: { ...CHILI, preparedGrams: 600 } });
    const [after] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(after).toEqual(before);
    expect(after.entries[0].nutrition.calories).toBeCloseTo(402.5);
  });

  it("refuses a Recipe that isn't in the Recipe Book (and doesn't create it), a name clash, or a bad Recipe", async () => {
    await expect(h.call(h.A, "putRecipe", { id: "nope", input: CHILI })).rejects.toThrow("That Recipe is no longer in the Recipe Book");
    expect(await recipes()).toEqual([]);
    await save("r1", CHILI);
    await save("r2", { ...CHILI, name: "Stew" });
    await expect(h.call(h.A, "putRecipe", { id: "r2", input: { ...CHILI, name: "chili" } })).rejects.toThrow("The Recipe Book already has Chili");
    await expect(h.call(h.A, "putRecipe", { id: "r1", input: { ...CHILI, ingredients: [] } })).rejects.toThrow("Add at least one ingredient");
    await expect(h.call(h.A, "putRecipe", { id: "r1", input: { ...CHILI, name: " CHILI " } })).resolves.toMatchObject({ name: "CHILI" });
  });
});

describe("deleteRecipe", () => {
  it("removes it from the Recipe Book and from every Member's Favorites; Entries stay", async () => {
    const chili = await save("r1", CHILI);
    await save("r2", { ...CHILI, name: "Stew" });
    const r = logRecipe(chili, { amount: 0.5, unit: "batch" }, "dinner");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });
    await h.call(h.A, "putFavorite", { input: { libraryId: "r1", lastUsed: 5 } });
    await h.call(h.B, "putFavorite", { input: { libraryId: "r1", lastUsed: 6 } });
    await h.call(h.B, "putFavorite", { input: { libraryId: "r2", lastUsed: 7 } });

    expect(await h.call(h.B, "deleteRecipe", { id: "r1" })).toBe("r1");
    expect((await recipes()).map((x) => x.id)).toEqual(["r2"]);
    expect(await h.call(h.A, "favorites")).toEqual([]);
    expect(await h.call(h.B, "favorites")).toEqual([{ libraryId: "r2", lastUsed: 7 }]);
    const [day] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(day.entries[0]).toMatchObject({ name: "Chili", libraryId: "r1", amount: 0.5, unit: "batch" });
  });

  it("a retry (already gone) succeeds", async () => {
    await expect(h.call(h.A, "deleteRecipe", { id: "r1" })).resolves.toBe("r1");
    await expect(h.call(h.A, "deleteRecipe", { id: "bad id!" })).rejects.toThrow("bad Recipe id");
  });

  it("an edit racing a delete doesn't bring the Recipe back", async () => {
    await save("r1", CHILI);
    await h.call(h.A, "deleteRecipe", { id: "r1" });
    await expect(h.call(h.B, "putRecipe", { id: "r1", input: CHILI })).rejects.toThrow("no longer in the Recipe Book");
    expect(await recipes()).toEqual([]);
  });
});

describe("a saved Recipe as an ingredient (one level deep)", () => {
  it("saves a Recipe with a saved Recipe in it, breakdown included, and reads it back", async () => {
    const chili = await save("chili", CHILI);
    const burrito = await save("burrito", { name: "Burrito", ingredients: [TORTILLA, asIngredient(chili, 300, "g")] }, h.B);
    expect(burrito.ingredients[1]).toMatchObject({ libraryId: "chili", name: "Chili", amount: 300, unit: "g", grams: 300 });
    expect(burrito.ingredients[1].ingredients?.map((i) => [i.name, i.grams])).toEqual([["Ground beef", 125], ["Kidney beans", 100]]);
    expect((await recipes()).find((r) => r.id === "burrito")).toEqual(burrito);
  });

  it("refuses a Recipe two levels deep, by breakdown or by pointing at a Recipe that has one", async () => {
    const chili = await save("chili", CHILI);
    const burrito = await save("burrito", { name: "Burrito", ingredients: [TORTILLA, asIngredient(chili, 300, "g")] });
    const deep = { ...asIngredient(chili, 300, "g"), name: "Burrito", libraryId: "burrito", ingredients: burrito.ingredients };
    await expect(save("plate", { name: "Plate", ingredients: [deep] })).rejects.toThrow("Recipes nest only one level deep");
    const hidden = { ...TORTILLA, libraryId: "burrito", name: "Burrito" };
    await expect(save("plate", { name: "Plate", ingredients: [hidden] })).rejects.toThrow("Burrito already has a Recipe in it");
    expect((await recipes()).map((r) => r.id).sort()).toEqual(["burrito", "chili"]);
  });

  it("refuses an edit that would nest deeper: a Recipe in itself, or a Recipe in one another Recipe uses", async () => {
    const chili = await save("chili", CHILI);
    const stew = await save("stew", { ...CHILI, name: "Stew" });
    await save("burrito", { name: "Burrito", ingredients: [TORTILLA, asIngredient(chili, 300, "g")] });
    await expect(h.call(h.A, "putRecipe", { id: "chili", input: { ...CHILI, ingredients: [...CHILI.ingredients, asIngredient(chili, 0.5, "batch")] } }))
      .rejects.toThrow("A Recipe can't be an ingredient of itself");
    await expect(h.call(h.A, "putRecipe", { id: "chili", input: { ...CHILI, ingredients: [...CHILI.ingredients, asIngredient(stew, 0.5, "batch")] } }))
      .rejects.toThrow("Chili is an ingredient of Burrito");
    // Stew isn't used anywhere, so it may hold a Recipe.
    await expect(h.call(h.A, "putRecipe", { id: "stew", input: { ...CHILI, name: "Stew", ingredients: [asIngredient(chili, 0.5, "batch")] } }))
      .resolves.toMatchObject({ id: "stew" });
  });
});
