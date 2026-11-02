// Estimating a Food with Bedrock through the Member API (Seam 2, Bedrock stubbed).
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182 };

describe("estimate (a Member types a Food and Bedrock estimates it)", () => {
  it("returns all 7 nutrients for the named serving plus the serving's gram weight", async () => {
    h.bedrock.reply(JSON.stringify({ ...EGGS, servingGrams: 122 }));
    const r = await h.call(h.A, "estimate", { text: "2 eggs scrambled" });
    expect(r).toEqual({ name: "2 eggs scrambled", nutrition: EGGS, servingGrams: 122, yieldRatio: null });
    expect(h.bedrock.lastPrompt()).toContain("2 eggs scrambled");
    expect(h.bedrock.calls[0].modelId).toBe("test-model");
  });

  it("reads a reply wrapped in a code fence or prose, and rounds to 0.1", async () => {
    h.bedrock.reply('Here you go:\n```json\n{"carbs": 30.04, "protein": 18, "fat": 14, "fiber": 3, "sodium": 380, "iron": 2.46, "calories": 330, "servingGrams": 180.26}\n```');
    const r = await h.call(h.A, "estimate", { text: "2 eggs and toast" });
    expect(r.nutrition).toEqual({ carbs: 30, protein: 18, fat: 14, fiber: 3, sodium: 380, iron: 2.5, calories: 330 });
    expect(r.servingGrams).toBe(180.3);
  });

  it("turns junk numbers into 0, never NaN, and drops an unbelievable serving weight", async () => {
    h.bedrock.reply('{"carbs": "about 20 g", "protein": "lots", "fat": null, "fiber": -4, "sodium": [], "calories": "NaN", "servingGrams": "unknown"}');
    const r = await h.call(h.A, "estimate", { text: "mystery stew" });
    expect(r.nutrition).toEqual({ carbs: 20, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 0 });
    expect(r.servingGrams).toBeNull();
    h.bedrock.reply('{"calories": 1e9, "servingGrams": 0}');
    const big = await h.call(h.A, "estimate", { text: "everything" });
    expect(big.nutrition.calories).toBe(100_000);
    expect(big.servingGrams).toBeNull();
  });

  it("an unrecognizable food comes back as all 0", async () => {
    h.bedrock.reply('{"carbs":0,"protein":0,"fat":0,"fiber":0,"sodium":0,"iron":0,"calories":0,"servingGrams":0}');
    const r = await h.call(h.A, "estimate", { text: "zxqv" });
    expect(Object.values(r.nutrition).every((v) => v === 0)).toBe(true);
  });

  it("refuses with a plain message when Bedrock fails or replies with no JSON", async () => {
    const msg = "Unavailable: Couldn't estimate that right now. Try again, or type the nutrition by hand.";
    h.bedrock.fail(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
    await expect(h.call(h.A, "estimate", { text: "apple" })).rejects.toThrow(msg);
    h.bedrock.reply("Sorry, I can't help with that.");
    await expect(h.call(h.A, "estimate", { text: "apple" })).rejects.toThrow(msg);
  });

  it("caps the food text at 200 characters and refuses empty text without calling Bedrock", async () => {
    h.bedrock.reply(JSON.stringify(EGGS));
    const r = await h.call(h.A, "estimate", { text: `  ${"rice ".repeat(100)}\n` });
    expect(r.name.length).toBeLessThanOrEqual(200);
    expect(r.name.startsWith("rice rice")).toBe(true);
    expect(h.bedrock.lastPrompt()).not.toContain("rice ".repeat(41));
    await expect(h.call(h.A, "estimate", { text: "  \n " })).rejects.toThrow("ValidationError: Type a Food to estimate");
    expect(h.bedrock.calls).toHaveLength(1);
  });

  it("asks for and returns a Yield ratio only for a recipe ingredient", async () => {
    h.bedrock.reply(JSON.stringify({ ...EGGS, servingGrams: 100, yieldRatio: 2.5 }));
    const plain = await h.call(h.A, "estimate", { text: "1 cup dry rice" });
    expect(plain.yieldRatio).toBeNull();
    expect(JSON.stringify(h.bedrock.calls[0].system)).not.toContain("yieldRatio");
    const ing = await h.call(h.A, "estimate", { text: "1 cup dry rice", ingredient: true });
    expect(ing.yieldRatio).toBe(2.5);
    expect(JSON.stringify(h.bedrock.calls[1].system)).toContain("yieldRatio");
    h.bedrock.reply(JSON.stringify({ ...EGGS, yieldRatio: 400 }));
    expect((await h.call(h.A, "estimate", { text: "rice", ingredient: true })).yieldRatio).toBeNull();
  });

  it("is Members only: an unknown username is refused before Bedrock is called", async () => {
    await expect(h.call({ userId: "sub-x", username: "stranger" }, "estimate", { text: "apple" })).rejects.toThrow("Forbidden");
    expect(h.bedrock.calls).toHaveLength(0);
  });
});
