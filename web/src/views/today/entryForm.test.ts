import { describe, expect, it } from "vitest";
import { entryFromEstimate, readEntryForm } from "./entryForm";

const blank = { carbs: "", protein: "", fat: "", fiber: "", sodium: "", iron: "", calories: "" };

describe("readEntryForm (typing an Entry's nutrition by hand)", () => {
  it("reads a name, a Meal and each nutrient; blank nutrients are 0", () => {
    expect(readEntryForm({ name: "  Oatmeal ", meal: "breakfast", values: { ...blank, carbs: "27", protein: "5.5", calories: "150" } }))
      .toEqual({ ok: true, entry: { meal: "breakfast", name: "Oatmeal", nutrition: { carbs: 27, protein: 5.5, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 150 } } });
  });

  it("asks for a name", () => {
    expect(readEntryForm({ name: " ", meal: "lunch", values: blank })).toEqual({ ok: false, error: "Give the Entry a name" });
  });

  it("refuses negative or non-numeric nutrients with a message naming the nutrient", () => {
    expect(readEntryForm({ name: "x", meal: "lunch", values: { ...blank, fat: "-2" } })).toEqual({ ok: false, error: "Fat must be a number, 0 or more" });
    expect(readEntryForm({ name: "x", meal: "lunch", values: { ...blank, sodium: "lots" } })).toEqual({ ok: false, error: "Sodium must be a number, 0 or more" });
  });
});

describe("entryFromEstimate (logging a Bedrock estimate)", () => {
  const nutrition = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182 };

  it("logs the estimated serving into the Meal, with its gram weight", () => {
    expect(entryFromEstimate({ name: "2 eggs scrambled", nutrition, servingGrams: 122, yieldRatio: null }, "breakfast"))
      .toEqual({ meal: "breakfast", name: "2 eggs scrambled", nutrition, grams: 122 });
  });

  it("leaves grams off when Bedrock gave none", () => {
    expect(entryFromEstimate({ name: "soup", nutrition, servingGrams: null, yieldRatio: null }, "lunch"))
      .toEqual({ meal: "lunch", name: "soup", nutrition });
  });
});
