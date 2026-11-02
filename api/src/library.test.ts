// The shared Library (Seam 2, Bedrock stubbed): every Member estimate saves a Food per gram with
// units, names are deduplicated case-insensitively, both Members see the same Library, and
// Entries logged from it keep their own snapshot.
import { beforeEach, describe, expect, it } from "vitest";
import { logFood, type Food } from "@nutrisage/shared";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.8, calories: 180 };

async function estimateAs(member: typeof h.A, text: string, reply: object = { ...EGGS, servingGrams: 120 }, ingredient?: boolean) {
  h.bedrock.reply(JSON.stringify(reply));
  return h.call(member, "estimate", { text, ...(ingredient ? { ingredient } : {}) });
}

const foods = async (member = h.A): Promise<Food[]> => (await h.call(member, "library")).foods;

describe("estimating a Food adds it to the shared Library", () => {
  it("saves the estimate as a Food per gram, with serving, g and Bedrock's units, and returns it", async () => {
    const r = await estimateAs(h.A, "2 eggs scrambled", { ...EGGS, servingGrams: 120, units: { egg: 60 } });
    expect(r.food).toMatchObject({
      name: "2 eggs scrambled", createdBy: "member-a",
      units: [{ label: "serving", grams: 120 }, { label: "g", grams: 1 }, { label: "egg", grams: 60 }],
    });
    expect(r.food.nutrition.calories).toBeCloseTo(1.5);
    expect(r.food.nutrition.sodium).toBeCloseTo(2.85);
    expect(typeof r.food.id).toBe("string");
    expect(typeof r.food.updatedAt).toBe("number");
    expect(await foods()).toEqual([r.food]);
  });

  it("both Members see the same Library", async () => {
    const a = await estimateAs(h.A, "Greek yogurt");
    const b = await estimateAs(h.B, "Banana");
    expect((await foods(h.A)).map((f) => f.name).sort()).toEqual(["Banana", "Greek yogurt"]);
    expect(await foods(h.B)).toEqual(await foods(h.A));
    expect([a.food.createdBy, b.food.createdBy]).toEqual(["member-a", "member-b"]);
  });

  it("dedupes by name ignoring case and spacing: the existing Food is kept and returned", async () => {
    const first = await estimateAs(h.A, "Greek Yogurt");
    const again = await estimateAs(h.B, "  greek   YOGURT ", { ...EGGS, calories: 999, servingGrams: 50 });
    expect(again.food).toEqual(first.food);
    expect(again.nutrition.calories).toBe(999);
    expect(await foods()).toHaveLength(1);
  });

  it("keeps a Yield ratio from an ingredient estimate", async () => {
    const r = await estimateAs(h.A, "dry rice", { ...EGGS, servingGrams: 50, yieldRatio: 2.5 }, true);
    expect(r.food.yieldRatio).toBe(2.5);
  });

  it("a serving with no known weight becomes a Food with only a serving unit", async () => {
    const r = await estimateAs(h.A, "Mystery stew", { ...EGGS });
    expect(r.food.units.map((u: { label: string }) => u.label)).toEqual(["serving"]);
    expect(r.food.nutrition.calories).toBe(180);
  });

  it("an unrecognizable food (all 0) is not saved", async () => {
    const r = await estimateAs(h.A, "qwzx", {});
    expect(r.food ?? null).toBeNull();
    expect(await foods()).toEqual([]);
  });

  it("stops adding once the Library is full, but the estimate still comes back", async () => {
    for (let i = 0; i < 3; i++) h.db.seed({ PK: "HOUSEHOLD", SK: `FOOD#x${i}`, id: `x${i}`, name: `Food ${i}`, nutrition: EGGS, units: [{ label: "serving", grams: 1 }], createdBy: "member-a", updatedAt: 1 });
    const { LIBRARY_LIMITS } = await import("./resolvers/library");
    const was = LIBRARY_LIMITS.foods;
    (LIBRARY_LIMITS as { foods: number }).foods = 3;
    try {
      const r = await estimateAs(h.A, "One too many");
      expect(r.food ?? null).toBeNull();
      expect(r.nutrition.calories).toBe(180);
      expect(await foods()).toHaveLength(3);
    } finally {
      (LIBRARY_LIMITS as { foods: number }).foods = was;
    }
  });

  it("is Members only: an unknown username can't read the Library", async () => {
    await estimateAs(h.A, "Greek yogurt");
    await expect(h.call({ userId: "sub-x", username: "stranger" }, "library")).rejects.toThrow();
  });
});

describe("logging from the Library", () => {
  it("Member B logs Member A's Food by amount x unit, and the Entry keeps its snapshot", async () => {
    const { food } = await estimateAs(h.A, "Eggs", { ...EGGS, servingGrams: 120, units: { egg: 60 } });
    const [shared] = await foods(h.B);
    const r = logFood(shared, { amount: 3, unit: "egg" }, "breakfast");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.B, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });

    // A later change to the Library Food leaves the logged Entry alone.
    h.db.seed({ PK: "HOUSEHOLD", SK: `FOOD#${food.id}`, ...food, name: "Eggs (edited)", nutrition: { ...food.nutrition, calories: 100 } });
    const [day] = await h.call(h.B, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(day.entries[0]).toMatchObject({ name: "Eggs", amount: 3, unit: "egg", grams: 180, libraryId: food.id });
    expect(day.entries[0].nutrition.calories).toBeCloseTo(270);
  });

  it("refuses a bad Library reference on an Entry", async () => {
    const entry = { id: "e1", meal: "lunch", name: "x", nutrition: { ...EGGS }, libraryId: "not ok!" };
    await expect(h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [entry] } })).rejects.toThrow("ValidationError");
  });
});
