import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const GOALS = { carbs: 250, protein: 160, fat: 75, fiber: 35, sodium: 2300, iron: 8, calories: 2400, water: 10 };

describe("a Member's goals", () => {
  it("before any are set, every nutrient has no goal (0) and water defaults to 8 cups", async () => {
    expect(await h.call(h.A, "goals", {})).toEqual({ carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 0, water: 8 });
  });

  it("a Member reads back the goals they put, for every nutrient and water", async () => {
    expect(await h.call(h.A, "putGoals", { input: GOALS })).toEqual(GOALS);
    expect(await h.call(h.A, "goals", {})).toEqual(GOALS);
  });

  it("are per Member", async () => {
    await h.call(h.A, "putGoals", { input: GOALS });
    expect((await h.call(h.B, "goals", {})).calories).toBe(0);
  });

  it("putting goals replaces them (last write wins)", async () => {
    await h.call(h.A, "putGoals", { input: GOALS });
    await h.call(h.A, "putGoals", { input: { ...GOALS, calories: 2000, water: 6 } });
    expect(await h.call(h.A, "goals", {})).toMatchObject({ calories: 2000, water: 6, protein: 160 });
  });

  it("refuses negative, non-finite, missing or absurd numbers and writes nothing", async () => {
    for (const input of [{ ...GOALS, fat: -1 }, { ...GOALS, carbs: "12" }, { ...GOALS, calories: Infinity }, { carbs: 1 }, { ...GOALS, water: 101 }]) {
      await expect(h.call(h.A, "putGoals", { input })).rejects.toThrow(/^ValidationError/);
    }
    expect(h.db.dump()).toEqual([]);
  });

  it("are refused to an unknown username", async () => {
    await expect(h.call({ userId: "x", username: "stranger" }, "goals", {})).rejects.toThrow("Forbidden");
  });
});
