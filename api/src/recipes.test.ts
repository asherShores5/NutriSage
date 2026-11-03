// Recipes in the shared Library (ticket 17, Seam 2): saving a Recipe puts it in the Recipe Book
// (HOUSEHOLD / RECIPE#<id>) beside the Foods, for both Members; a Recipe Entry keeps its breakdown.
import { beforeEach, describe, expect, it } from "vitest";
import { emptyNutrition, logRecipe, type NewRecipe, type Recipe } from "@nutrisage/shared";
import { harness } from "./testing/harness";

const h = harness();
// After the harness has set the env: the resolvers read it at import time.
const { LIBRARY_LIMITS } = await import("./resolvers/library");
beforeEach(() => {
  h.reset();
  LIBRARY_LIMITS.recipes = 500;
});

const n = (calories: number, protein = 0) => ({ ...emptyNutrition(), calories, protein });
const CHILI: NewRecipe = {
  name: "Chili",
  ingredients: [
    { libraryId: "beef", name: "Ground beef", amount: 500, unit: "g", grams: 500, nutrition: n(1250, 100), yieldRatio: 0.75 },
    { libraryId: "beans", name: "Kidney beans", amount: 1, unit: "can", grams: 400, nutrition: n(360) },
    { libraryId: null, name: "Chili spice", amount: 1, unit: "serving", nutrition: n(20) },
  ],
  preparedGrams: 1200,
};

const recipes = async (member = h.A): Promise<Recipe[]> => (await h.call(member, "library")).recipes;

describe("addRecipe (save to the Recipe Book)", () => {
  it("saves the Recipe in the shared Library with the caller as creator; both Members see it", async () => {
    const saved = await h.call(h.A, "addRecipe", { id: "r1", input: CHILI });
    expect(saved).toMatchObject({ id: "r1", name: "Chili", createdBy: "member-a", preparedGrams: 1200, ingredients: CHILI.ingredients });
    expect(typeof saved.updatedAt).toBe("number");
    expect(await recipes(h.A)).toEqual([saved]);
    expect(await recipes(h.B)).toEqual([saved]);
  });

  it("keeps Recipes apart from Foods", async () => {
    await h.call(h.A, "addRecipe", { id: "r1", input: CHILI });
    expect((await h.call(h.A, "library")).foods).toEqual([]);
  });

  it("a Prepared weight is optional", async () => {
    const saved = await h.call(h.A, "addRecipe", { id: "r1", input: { ...CHILI, preparedGrams: null } });
    expect(saved.preparedGrams).toBeNull();
  });

  it("saving the same id again (a retry) returns the saved Recipe unchanged", async () => {
    const first = await h.call(h.A, "addRecipe", { id: "r1", input: CHILI });
    const again = await h.call(h.B, "addRecipe", { id: "r1", input: { ...CHILI, name: "Other" } });
    expect(again).toEqual(first);
    expect(await recipes()).toHaveLength(1);
  });

  it("refuses a second Recipe with the same name (ignoring case)", async () => {
    await h.call(h.A, "addRecipe", { id: "r1", input: CHILI });
    await expect(h.call(h.B, "addRecipe", { id: "r2", input: { ...CHILI, name: " CHILI " } })).rejects.toThrow("The Recipe Book already has Chili");
  });

  it("refuses a bad Recipe with the shared checks", async () => {
    await expect(h.call(h.A, "addRecipe", { id: "r1", input: { ...CHILI, name: "" } })).rejects.toThrow("Give the Recipe a name");
    await expect(h.call(h.A, "addRecipe", { id: "r1", input: { ...CHILI, ingredients: [] } })).rejects.toThrow("Add at least one ingredient");
    await expect(h.call(h.A, "addRecipe", { id: "bad id!", input: CHILI })).rejects.toThrow("bad Recipe id");
  });

  it("caps the Recipe Book", async () => {
    LIBRARY_LIMITS.recipes = 1;
    await h.call(h.A, "addRecipe", { id: "r1", input: CHILI });
    await expect(h.call(h.A, "addRecipe", { id: "r2", input: { ...CHILI, name: "Stew" } })).rejects.toThrow("The Recipe Book is full");
  });
});

describe("a Recipe Entry", () => {
  it("keeps its ingredient breakdown snapshot on the Day", async () => {
    const r = logRecipe({ ...CHILI, id: "r1" }, { amount: 300, unit: "g" }, "dinner");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });
    const [day] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(day.entries[0]).toMatchObject({ name: "Chili", amount: 300, unit: "g", grams: 300, libraryId: "r1" });
    expect(day.entries[0].ingredients.map((i: { name: string; grams?: number }) => [i.name, i.grams])).toEqual([
      ["Ground beef", 125], ["Kidney beans", 100], ["Chili spice", undefined],
    ]);
  });

  it("refuses junk in the breakdown", async () => {
    const entry = { id: "e1", meal: "dinner", name: "Chili", nutrition: n(100), ingredients: [{ name: "Beef", nutrition: { ...n(1), fat: -1 } }] };
    await expect(h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [entry] } })).rejects.toThrow("fat");
    const many = { ...entry, ingredients: Array(51).fill({ name: "Beef", nutrition: n(1) }) };
    await expect(h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [many] } })).rejects.toThrow("at most 50 ingredients");
  });
});
