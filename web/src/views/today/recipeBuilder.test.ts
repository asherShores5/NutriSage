import { describe, expect, it } from "vitest";
import { emptyNutrition, type Food } from "@nutrisage/shared";
import { foodFromEstimate, needsYieldSuggestion, preparedNote, readBuilder, readPrepared, readYieldRatio, switchPortionUnit, withYieldRatio, type BuilderInput } from "./recipeBuilder";

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

  it("logs in g on the weighed Prepared weight, pointing the Entry at the saved Recipe", () => {
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

describe("an unweighed Recipe", () => {
  const RICE: Food = { ...BEANS, id: "rice", name: "Dry rice", units: [{ label: "serving", grams: 45 }, { label: "g", grams: 1 }], yieldRatio: 2.5 };

  it("logs in g on the Prepared weight estimated from Yield ratios, without saving the estimate", () => {
    // 2 cans of beans (800 g, ratio 1) + 200 g rice x 2.5 = 1300 g
    const rows = [{ key: "a", food: BEANS, amount: "2", unit: "can" }, { key: "b", food: RICE, amount: "200", unit: "g" }];
    const r = readBuilder(input({ rows, portion: "130", portionUnit: "g" }));
    expect(r).toMatchObject({ ok: true, recipe: { preparedGrams: null }, entry: { grams: 130, unit: "g" } });
    expect(r.ok && r.entry.nutrition.calories).toBeCloseTo(90); // (720 + 180) / 10
  });

  it("an edited Yield ratio changes the estimate", () => {
    const rows = [{ key: "b", food: withYieldRatio(RICE, 3), amount: "200", unit: "g" }];
    const r = readBuilder(input({ rows, portion: "1", portionUnit: "batch" }));
    expect(r.ok && r.entry.grams).toBe(600);
    expect(withYieldRatio(RICE, null).yieldRatio).toBeUndefined();
  });
});

describe("the Prepared weight note", () => {
  it("says whether the Prepared weight is weighed or estimated, and what it needs when unknown", () => {
    expect(preparedNote({ grams: 1200, source: "weighed" })).toBe("Weighed");
    expect(preparedNote({ grams: 1254.6, source: "estimated" })).toBe("Estimated 1255 g from Yield ratios. Weigh the batch for exact portions.");
    expect(preparedNote(null)).toBe("Not known (an ingredient has no gram weight): weigh the batch to log in g, or log a fraction of it");
  });
});

describe("Yield ratios in the builder", () => {
  it("reads a typed ratio: blank is unknown (x1), else more than 0 and at most 20", () => {
    expect(readYieldRatio(" ")).toEqual({ ok: true, ratio: null });
    expect(readYieldRatio("2,5")).toEqual({ ok: true, ratio: 2.5 });
    expect(readYieldRatio("0")).toEqual({ ok: false, error: "Yield ratio must be more than 0 and at most 20" });
    expect(readYieldRatio("50")).toMatchObject({ ok: false });
    expect(readYieldRatio("abc")).toMatchObject({ ok: false });
  });

  it("asks Bedrock only for a Library Food that has no ratio and a known gram weight", () => {
    expect(needsYieldSuggestion(BEANS)).toBe(true);
    expect(needsYieldSuggestion({ ...BEANS, yieldRatio: 1 })).toBe(false);
    expect(needsYieldSuggestion({ ...BEANS, id: "" })).toBe(false); // not in the Library
    expect(needsYieldSuggestion({ ...BEANS, units: [{ label: "serving", grams: 1 }] })).toBe(false); // weight unknown: no estimate anyway
  });
});

describe("switching the portion unit", () => {
  it("keeps the same share of the batch when the Prepared weight is known", () => {
    expect(switchPortionUnit("1/4", "batch", "g", 1200)).toBe("300");
    expect(switchPortionUnit("300", "g", "batch", 1200)).toBe("1/4");
    expect(switchPortionUnit("1/4", "batch", "g", null)).toBe("1/4");
  });
});
