import { describe, expect, it } from "vitest";
import { entryFromEstimate, readEntryForm } from "./entryForm";

const blank = { carbs: "", protein: "", fat: "", fiber: "", sodium: "", iron: "", calories: "" };

describe("readEntryForm (typing an Entry's nutrition by hand)", () => {
  it("reads a name, a Meal and each nutrient; blank nutrients are 0", () => {
    expect(readEntryForm({ name: "  Oatmeal ", meal: "breakfast", values: { ...blank, carbs: "27", protein: "5.5", calories: "150" }, amount: "1" }))
      .toEqual({ ok: true, entry: { meal: "breakfast", name: "Oatmeal", amount: 1, unit: "serving", nutrition: { carbs: 27, protein: 5.5, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 150 } } });
  });

  it("treats the typed nutrition as 1 serving and multiplies by the amount", () => {
    expect(readEntryForm({ name: "Toast", meal: "breakfast", values: { ...blank, carbs: "15", calories: "80" }, amount: "1 1/2" }))
      .toMatchObject({ ok: true, entry: { amount: 1.5, unit: "serving", nutrition: { carbs: 22.5, calories: 120 } } });
  });

  it("refuses a bad amount with the amount's message", () => {
    expect(readEntryForm({ name: "Toast", meal: "breakfast", values: blank, amount: "0" })).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(readEntryForm({ name: "Toast", meal: "breakfast", values: blank, amount: "lots" })).toEqual({ ok: false, error: "Type an amount like 0.4, 1/3 or 1 1/2" });
  });

  it("asks for a name", () => {
    expect(readEntryForm({ name: " ", meal: "lunch", values: blank, amount: "1" })).toEqual({ ok: false, error: "Give the Entry a name" });
  });

  it("refuses negative or non-numeric nutrients with a message naming the nutrient", () => {
    expect(readEntryForm({ name: "x", meal: "lunch", values: { ...blank, fat: "-2" }, amount: "1" })).toEqual({ ok: false, error: "Fat must be a number, 0 or more" });
    expect(readEntryForm({ name: "x", meal: "lunch", values: { ...blank, sodium: "lots" }, amount: "1" })).toEqual({ ok: false, error: "Sodium must be a number, 0 or more" });
  });
});

describe("entryFromEstimate (logging a Bedrock estimate)", () => {
  const nutrition = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182 };

  const eggs = { name: "2 eggs scrambled", nutrition, servingGrams: 122, yieldRatio: null };
  const soup = { name: "soup", nutrition, servingGrams: null, yieldRatio: null };

  it("logs one estimated serving into the Meal, with its gram weight", () => {
    expect(entryFromEstimate(eggs, "breakfast", { amount: 1, unit: "serving" }))
      .toEqual({ ok: true, entry: { meal: "breakfast", name: "2 eggs scrambled", amount: 1, unit: "serving", nutrition, grams: 122 } });
  });

  it("scales the serving to the amount, in servings or grams", () => {
    expect(entryFromEstimate(eggs, "breakfast", { amount: 2, unit: "serving" }))
      .toMatchObject({ ok: true, entry: { amount: 2, unit: "serving", grams: 244, nutrition: { calories: 364 } } });
    expect(entryFromEstimate(eggs, "breakfast", { amount: 61, unit: "g" }))
      .toMatchObject({ ok: true, entry: { amount: 61, unit: "g", grams: 61, nutrition: { calories: 91 } } });
  });

  it("leaves grams off when Bedrock gave none, and then can't log in g", () => {
    expect(entryFromEstimate(soup, "lunch", { amount: 1, unit: "serving" }))
      .toEqual({ ok: true, entry: { meal: "lunch", name: "soup", amount: 1, unit: "serving", nutrition } });
    expect(entryFromEstimate(soup, "lunch", { amount: 200, unit: "g" }))
      .toEqual({ ok: false, error: "No gram weight is known for a serving, so it can't be logged in g" });
  });
});
