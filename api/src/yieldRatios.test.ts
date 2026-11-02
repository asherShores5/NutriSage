// Yield ratios on Library Foods (ticket 18, Seam 2, Bedrock stubbed): Bedrock suggests a ratio for a
// Food that has none and it is saved on the Food; a Member's edit is kept and never overwritten.
import { beforeEach, describe, expect, it } from "vitest";
import { foodEdit, type Food } from "@nutrisage/shared";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const RICE = { carbs: 36, protein: 3.3, fat: 0.3, fiber: 0.6, sodium: 2, iron: 0.4, calories: 160, servingGrams: 45 };

/** A Library Food with no Yield ratio (a plain estimate doesn't ask for one). */
async function riceFood(): Promise<Food> {
  h.bedrock.reply(JSON.stringify({ ...RICE, yieldRatio: 9 }));
  const { food } = await h.call(h.A, "estimate", { text: "Dry rice" });
  expect(food.yieldRatio ?? null).toBeNull();
  return food;
}

const libraryFood = async (id: string, member = h.A): Promise<Food | undefined> =>
  ((await h.call(member, "library")).foods as Food[]).find((f) => f.id === id);

describe("suggestYieldRatio", () => {
  it("asks Bedrock for the Food's Yield ratio as a recipe ingredient and saves it on the Food", async () => {
    const rice = await riceFood();
    h.bedrock.reply(JSON.stringify({ ...RICE, yieldRatio: 2.5 }));
    const r = await h.call(h.A, "suggestYieldRatio", { id: rice.id });
    expect(r).toMatchObject({ id: rice.id, name: "Dry rice", yieldRatio: 2.5, createdBy: "member-a" });
    expect(h.bedrock.lastPrompt()).toContain("Dry rice");
    expect(JSON.stringify(h.bedrock.calls.at(-1)?.system)).toContain("yieldRatio");
    // Saved for next time, for both Members; the rest of the Food is unchanged.
    expect(await libraryFood(rice.id, h.B)).toEqual(r);
    expect(r.nutrition).toEqual(rice.nutrition);
    expect(r.units).toEqual(rice.units);
  });

  it("returns a Food that already has a ratio unchanged, without asking Bedrock", async () => {
    const rice = await riceFood();
    const edited = await h.call(h.A, "putFood", { id: rice.id, input: { ...foodEdit(rice), yieldRatio: 2.8 } });
    const asked = h.bedrock.calls.length;
    expect(await h.call(h.B, "suggestYieldRatio", { id: rice.id })).toEqual(edited);
    expect(h.bedrock.calls.length).toBe(asked);
  });

  it("saves nothing when Bedrock gives no believable ratio", async () => {
    const rice = await riceFood();
    h.bedrock.reply(JSON.stringify({ ...RICE, yieldRatio: 400 }));
    const r = await h.call(h.A, "suggestYieldRatio", { id: rice.id });
    expect(r.yieldRatio ?? null).toBeNull();
    expect(await libraryFood(rice.id)).toEqual(rice);
  });

  it("says plainly when Bedrock fails, the Food is gone, or the id is bad", async () => {
    const rice = await riceFood();
    h.bedrock.fail(Object.assign(new Error("slow down"), { name: "ThrottlingException" }));
    await expect(h.call(h.A, "suggestYieldRatio", { id: rice.id })).rejects.toThrow("Unavailable");
    await expect(h.call(h.A, "suggestYieldRatio", { id: "gone" })).rejects.toThrow("NotFound: That Food is no longer in the Library");
    await expect(h.call(h.A, "suggestYieldRatio", { id: "bad id!" })).rejects.toThrow("ValidationError: bad Food id");
  });
});

describe("a Member's Yield ratio edit", () => {
  it("persists on the Food and wins over later suggestions and estimates", async () => {
    const rice = await riceFood();
    await h.call(h.A, "putFood", { id: rice.id, input: { ...foodEdit(rice), yieldRatio: 3 } });
    expect((await libraryFood(rice.id, h.B))?.yieldRatio).toBe(3);
    h.bedrock.reply(JSON.stringify({ ...RICE, yieldRatio: 2.5 }));
    await h.call(h.B, "estimate", { text: "dry rice", ingredient: true });
    expect((await libraryFood(rice.id))?.yieldRatio).toBe(3);
  });
});

describe("an ingredient estimate of a Food already in the Library", () => {
  it("fills in the Food's missing Yield ratio", async () => {
    const rice = await riceFood();
    h.bedrock.reply(JSON.stringify({ ...RICE, yieldRatio: 2.5 }));
    const r = await h.call(h.B, "estimate", { text: "dry RICE", ingredient: true });
    expect(r.food).toMatchObject({ id: rice.id, yieldRatio: 2.5 });
    expect((await libraryFood(rice.id))?.yieldRatio).toBe(2.5);
  });
});
