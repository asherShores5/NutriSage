import { describe, expect, it } from "vitest";
import { foodFromServing, type Food } from "@nutrisage/shared";
import { foodToForm, readFoodForm } from "./foodForm";

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.8, calories: 180 };
const eggs: Food = { id: "f1", createdBy: "asher", updatedAt: 1, ...foodFromServing({ name: "Eggs", nutrition: EGGS, servingGrams: 120, units: [{ label: "egg", grams: 60 }] }) };

describe("the Library edit form", () => {
  it("shows a Food per serving, with blanks for an unknown Yield ratio", () => {
    expect(foodToForm(eggs)).toEqual({
      name: "Eggs",
      nutrition: { carbs: "1.2", protein: "12.6", fat: "10.1", fiber: "0", sodium: "342", iron: "1.8", calories: "180" },
      servingGrams: "120",
      units: [{ label: "egg", grams: "60" }],
      yieldRatio: "",
    });
  });

  it("reads the boxes back: blank nutrients are 0, blank serving weight and Yield ratio are unknown", () => {
    const v = { ...foodToForm(eggs), nutrition: { ...foodToForm(eggs).nutrition, fiber: " ", calories: "200.5" }, servingGrams: "", units: [], yieldRatio: "" };
    expect(readFoodForm(v)).toEqual({ ok: true, edit: { name: "Eggs", nutrition: { ...EGGS, fiber: 0, calories: 200.5 }, servingGrams: null, units: [], yieldRatio: null } });
    expect(readFoodForm({ ...foodToForm(eggs), yieldRatio: "2.5" })).toMatchObject({ ok: true, edit: { yieldRatio: 2.5, servingGrams: 120, units: [{ label: "egg", grams: 60 }] } });
  });

  it("names the box that isn't a number", () => {
    expect(readFoodForm({ ...foodToForm(eggs), nutrition: { ...foodToForm(eggs).nutrition, sodium: "lots" } })).toEqual({ ok: false, error: "Sodium must be a number" });
    expect(readFoodForm({ ...foodToForm(eggs), servingGrams: "1 cup" })).toEqual({ ok: false, error: "Serving weight must be a number of grams" });
    expect(readFoodForm({ ...foodToForm(eggs), units: [{ label: "egg", grams: "" }] })).toEqual({ ok: false, error: "Give egg a weight in grams" });
    expect(readFoodForm({ ...foodToForm(eggs), yieldRatio: "x2" })).toEqual({ ok: false, error: "Yield ratio must be a number" });
  });
});
