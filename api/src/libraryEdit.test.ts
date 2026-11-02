// Library edit and delete (ticket 15, Seam 2): either Member edits or deletes any Food; a delete
// takes every Member's Favorite of it along; Entries logged from it never change.
import { beforeEach, describe, expect, it } from "vitest";
import { foodEdit, logFood, type Food } from "@nutrisage/shared";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.8, calories: 180 };

async function addFood(text: string, member = h.A): Promise<Food> {
  h.bedrock.reply(JSON.stringify({ ...EGGS, servingGrams: 120, units: { egg: 60 } }));
  return (await h.call(member, "estimate", { text })).food;
}
const foods = async (member = h.A): Promise<Food[]> => (await h.call(member, "library")).foods;
const edit = (food: Food, change: object = {}) => ({ ...foodEdit(food), ...change });

describe("putFood (edit a Library Food)", () => {
  it("either Member edits any Food: name, per-serving nutrition stored per gram, units, Yield ratio", async () => {
    const food = await addFood("Eggs", h.A);
    const saved = await h.call(h.B, "putFood", {
      id: food.id,
      input: edit(food, { name: "Eggs, fried", nutrition: { ...EGGS, calories: 240 }, servingGrams: 100, units: [{ label: "egg", grams: 50 }], yieldRatio: 0.9 }),
    });
    expect(saved).toMatchObject({
      id: food.id, name: "Eggs, fried", createdBy: "member-a", yieldRatio: 0.9,
      units: [{ label: "serving", grams: 100 }, { label: "g", grams: 1 }, { label: "egg", grams: 50 }],
    });
    expect(saved.nutrition.calories).toBeCloseTo(2.4);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(food.updatedAt);
    expect(await foods(h.A)).toEqual([saved]);
  });

  it("leaves Entries logged from the Food untouched", async () => {
    const food = await addFood("Eggs");
    const r = logFood(food, { amount: 2, unit: "egg" }, "breakfast");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });
    const [before] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });

    await h.call(h.B, "putFood", { id: food.id, input: edit(food, { name: "Eggs (edited)", nutrition: { ...EGGS, calories: 999 }, units: [] }) });
    const [after] = await h.call(h.A, "days", { from: "2026-11-02", to: "2026-11-02" });
    expect(after).toEqual(before);
    expect(after.entries[0]).toMatchObject({ name: "Eggs", unit: "egg", grams: 120, libraryId: food.id });
    expect(after.entries[0].nutrition.calories).toBeCloseTo(180);
  });

  it("refuses a Food that isn't in the Library, and doesn't create it", async () => {
    const food = await addFood("Eggs");
    await expect(h.call(h.A, "putFood", { id: "gone-1", input: edit(food) })).rejects.toThrow("NotFound");
    expect(await foods()).toHaveLength(1);
  });

  it("refuses renaming onto another Food's name (ignoring case and spacing)", async () => {
    await addFood("Banana");
    const food = await addFood("Eggs");
    await expect(h.call(h.A, "putFood", { id: food.id, input: edit(food, { name: " BANANA " }) })).rejects.toThrow("ValidationError: The Library already has Banana");
  });

  it("refuses bad edits with the same words the form shows", async () => {
    const food = await addFood("Eggs");
    await expect(h.call(h.A, "putFood", { id: food.id, input: edit(food, { nutrition: { ...EGGS, fat: -1 } }) })).rejects.toThrow("ValidationError: fat must be a number from 0 to 100000");
    await expect(h.call(h.A, "putFood", { id: food.id, input: edit(food, { yieldRatio: 50 }) })).rejects.toThrow("ValidationError: Yield ratio");
    await expect(h.call(h.A, "putFood", { id: food.id, input: edit(food, { units: [{ label: "g", grams: 3 }] }) })).rejects.toThrow("ValidationError");
    await expect(h.call(h.A, "putFood", { id: "bad id!", input: edit(food) })).rejects.toThrow("ValidationError: bad Food id");
    expect(await foods()).toEqual([food]);
  });

  it("is Members only", async () => {
    const food = await addFood("Eggs");
    await expect(h.call({ userId: "sub-x", username: "stranger" }, "putFood", { id: food.id, input: edit(food, { name: "x" }) })).rejects.toThrow("Forbidden");
  });
});

describe("deleteFood", () => {
  /** A Favorite row as ticket 14 stores it: MEMBER#<username> / FAV#<libraryId>. */
  const fav = (username: string, libraryId: string) => ({ PK: `MEMBER#${username}`, SK: `FAV#${libraryId}`, libraryId, lastUsed: 1 });
  const favKeys = () => h.db.dump().filter((r) => String(r.SK).startsWith("FAV#")).map((r) => `${r.PK} ${r.SK}`).sort();

  it("removes the Food from the Library and every Member's Favorite of it, and nothing else", async () => {
    const eggs = await addFood("Eggs", h.A);
    const pear = await addFood("Pear", h.B);
    h.db.seed(fav("member-a", eggs.id), fav("member-b", eggs.id), fav("member-a", pear.id));

    expect(await h.call(h.B, "deleteFood", { id: eggs.id })).toBe(eggs.id);
    expect(await foods(h.A)).toEqual([pear]);
    expect(favKeys()).toEqual([`MEMBER#member-a FAV#${pear.id}`]);
  });

  it("leaves Entries logged from the Food untouched", async () => {
    const eggs = await addFood("Eggs");
    const r = logFood(eggs, { amount: 1, unit: "serving" }, "lunch");
    if (!r.ok) throw new Error(r.error);
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", ...r.entry }] } });
    await h.call(h.B, "putDay", { input: { date: "2026-11-01", entries: [{ id: "e2", ...r.entry }], water: 3 } });
    const before = [await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-02" }), await h.call(h.B, "days", { from: "2026-11-01", to: "2026-11-02" })];

    await h.call(h.A, "deleteFood", { id: eggs.id });
    const after = [await h.call(h.A, "days", { from: "2026-11-01", to: "2026-11-02" }), await h.call(h.B, "days", { from: "2026-11-01", to: "2026-11-02" })];
    expect(after).toEqual(before);
    expect(after[1][0].entries[0]).toMatchObject({ name: "Eggs", libraryId: eggs.id });
  });

  it("deleting a Food that's already gone is fine (a retry after a lost reply)", async () => {
    const eggs = await addFood("Eggs");
    await h.call(h.A, "deleteFood", { id: eggs.id });
    expect(await h.call(h.B, "deleteFood", { id: eggs.id })).toBe(eggs.id);
    expect(await foods()).toEqual([]);
  });

  it("refuses a bad id and strangers", async () => {
    const eggs = await addFood("Eggs");
    await expect(h.call(h.A, "deleteFood", { id: "FOOD#x" })).rejects.toThrow("ValidationError: bad Food id");
    await expect(h.call({ userId: "sub-x", username: "stranger" }, "deleteFood", { id: eggs.id })).rejects.toThrow("Forbidden");
    expect(await foods()).toEqual([eggs]);
  });
});
