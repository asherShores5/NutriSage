import { describe, expect, it } from "vitest";
import { emptyNutrition, type Food } from "@nutrisage/shared";
import { foodFromEstimate, readBuilder, readPrepared, switchPortionUnit, type BuilderInput } from "./recipeBuilder";

const BEANS: Food = {
  id: "beans", name: "Kidney beans", nutrition: { ...emptyNutrition(), calories: 0.9 },
  units: [{ label: "serving", grams: 130 }, { label: "g", grams: 1 }, { label: "can", grams: 400 }], createdBy: "asher", updatedAt: 1,
};
const input = (change: Partial<BuilderInput> = {}): BuilderInput => ({
  name: "Beans", rows: [{ key: "a", food: BEANS, amount: "2", unit: "can" }], prepared: "", portion: "1/4", portionUnit: "batch", meal: "dinner", ...change,
});

describe("the Recipe builder", () => {
  it("logs a fraction of the batch without a Prepared weight", () => {
    const r = readBuilder(input());
    expect(r).toMatchObject({ ok: true, recipe: { name: "Beans", preparedGrams: null }, entry: { name: "Beans", amount: 0.25, unit: "batch" } });
    expect(r.ok && r.entry.nutrition.calories).toBe(180); // 2 cans x 400 g x 0.9 / 4
  });

  it("needs the Prepared weight to log in g, then points the Entry at the saved Recipe", () => {
    expect(readBuilder(input({ portion: "200", portionUnit: "g" }))).toMatchObject({ ok: false, error: expect.stringContaining("Prepared weight") });
    const r = readBuilder(input({ portion: "200", portionUnit: "g", prepared: "720" }), "r1");
    expect(r).toMatchObject({ ok: true, entry: { grams: 200, libraryId: "r1" } });
    expect(r.ok && r.entry.nutrition.calories).toBe(200); // 720 cal over 720 g
  });

  it("shows a row's bad amount, a bad Prepared weight, or a missing name", () => {
    expect(readBuilder(input({ rows: [{ key: "a", food: BEANS, amount: "0", unit: "can" }] }))).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(readPrepared("abc")).toMatchObject({ ok: false });
    expect(readPrepared(" ")).toEqual({ ok: true, grams: null });
    expect(readBuilder(input({ name: "" }))).toEqual({ ok: false, error: "Give the Recipe a name" });
  });

  it("an estimate the Library didn't keep still makes an ingredient, pointing at nothing", () => {
    const food = foodFromEstimate({ name: "Saffron", nutrition: { ...emptyNutrition(), calories: 3 }, servingGrams: 1, yieldRatio: null, units: [], food: null });
    const r = readBuilder(input({ rows: [{ key: "a", food, amount: "1", unit: "serving" }], portion: "1" }));
    expect(r.ok && r.recipe.ingredients[0]).toMatchObject({ libraryId: null, name: "Saffron", grams: 1 });
  });
});

describe("switching the portion unit", () => {
  it("keeps the same share of the batch when the Prepared weight is known", () => {
    expect(switchPortionUnit("1/4", "batch", "g", 1200)).toBe("300");
    expect(switchPortionUnit("300", "g", "batch", 1200)).toBe("1/4");
    expect(switchPortionUnit("1/4", "batch", "g", null)).toBe("1/4");
  });
});
