import { describe, expect, it } from "vitest";
import { foodFromServing, type Food } from "./food";
import { editedFood, foodEdit } from "./foodEdit";

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.8, calories: 180 };
const saved = (f: ReturnType<typeof foodFromServing>): Food => ({ id: "f1", createdBy: "asher", updatedAt: 1, ...f });
const eggs = saved(foodFromServing({ name: "Eggs", nutrition: EGGS, servingGrams: 120, units: [{ label: "egg", grams: 60 }], yieldRatio: 0.9 }));
const stew = saved(foodFromServing({ name: "Mystery stew", nutrition: EGGS, servingGrams: null }));

describe("foodEdit (a Library Food as the edit form shows it)", () => {
  it("shows nutrition per serving, the serving weight, the other units and the Yield ratio", () => {
    const e = foodEdit(eggs);
    expect(e.name).toBe("Eggs");
    expect(e.nutrition).toEqual(EGGS);
    expect(e.servingGrams).toBe(120);
    expect(e.units).toEqual([{ label: "egg", grams: 60 }]);
    expect(e.yieldRatio).toBe(0.9);
  });

  it("an unweighed Food has no serving weight and no other units", () => {
    expect(foodEdit(stew)).toEqual({ name: "Mystery stew", nutrition: EGGS, servingGrams: null, units: [], yieldRatio: null });
  });
});

describe("editedFood (the form back to a Food stored per gram)", () => {
  const ok = (r: ReturnType<typeof editedFood>) => {
    if (!r.ok) throw new Error(r.error);
    return r.food;
  };

  it("an unchanged form gives back the same Food", () => {
    const f = ok(editedFood(foodEdit(eggs)));
    expect(f.units).toEqual(eggs.units);
    expect(f.yieldRatio).toBe(0.9);
    expect(f.nutrition.calories).toBeCloseTo(1.5);
  });

  it("stores per-serving nutrition per gram: 240 cal in a 120 g serving is 2 cal/g", () => {
    const f = ok(editedFood({ ...foodEdit(eggs), name: "  Eggs, fried ", nutrition: { ...EGGS, calories: 240 } }));
    expect(f.name).toBe("Eggs, fried");
    expect(f.nutrition.calories).toBeCloseTo(2);
    expect(f.nutrition.sodium).toBeCloseTo(2.85);
  });

  it("giving an unweighed Food a serving weight rescales it to per gram and adds g", () => {
    const f = ok(editedFood({ ...foodEdit(stew), servingGrams: 300, units: [{ label: "Bowl", grams: 450 }] }));
    expect(f.units).toEqual([{ label: "serving", grams: 300 }, { label: "g", grams: 1 }, { label: "bowl", grams: 450 }]);
    expect(f.nutrition.calories).toBeCloseTo(0.6);
  });

  it("clearing the Yield ratio or the serving weight removes them", () => {
    const f = ok(editedFood({ ...foodEdit(eggs), servingGrams: null, units: [], yieldRatio: null }));
    expect(f.units).toEqual([{ label: "serving", grams: 1 }]);
    expect(f.nutrition.calories).toBe(180);
    expect(f.yieldRatio ?? null).toBeNull();
  });

  it.each([
    [{ name: "  " }, "Give the Food a name"],
    [{ name: "x".repeat(121) }, "Name must be at most 120 characters"],
    [{ nutrition: { ...EGGS, fat: -1 } }, "fat must be a number from 0 to 100000"],
    [{ nutrition: { ...EGGS, iron: NaN } }, "iron must be a number from 0 to 100000"],
    [{ nutrition: { ...EGGS, calories: 100001 } }, "calories must be a number from 0 to 100000"],
    [{ servingGrams: 0 }, "Serving weight must be more than 0 and at most 10000 g"],
    [{ servingGrams: 20000 }, "Serving weight must be more than 0 and at most 10000 g"],
    [{ units: [{ label: "", grams: 5 }] }, "Every unit needs a name"],
    [{ units: [{ label: "Egg", grams: 60 }, { label: "egg ", grams: 61 }] }, "There are two units called egg"],
    [{ units: [{ label: "g", grams: 2 }] }, "g and serving are always there; pick another unit name"],
    [{ units: [{ label: "cup", grams: 0 }] }, "A cup must weigh more than 0 and at most 10000 g"],
    [{ units: [{ label: "x".repeat(31), grams: 1 }] }, "Unit names must be at most 30 characters"],
    [{ units: Array.from({ length: 11 }, (_, i) => ({ label: `u${i}`, grams: 1 })) }, "At most 10 other units"],
    [{ servingGrams: null, units: [{ label: "cup", grams: 200 }] }, "Give the serving a weight before adding other units"],
    [{ yieldRatio: 0 }, "Yield ratio must be more than 0 and at most 20"],
    [{ yieldRatio: 21 }, "Yield ratio must be more than 0 and at most 20"],
  ])("refuses %j: %s", (change, error) => {
    expect(editedFood({ ...foodEdit(eggs), ...change })).toEqual({ ok: false, error });
  });
});
