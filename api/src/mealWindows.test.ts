import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const DEFAULTS = { breakfast: "00:00", lunch: "10:30", snack: "14:30", dinner: "17:00", dessert: "20:30" };
const MINE = { breakfast: "05:30", lunch: "11:00", snack: "15:00", dinner: "18:00", dessert: "21:00" };

describe("a Member's Meal windows", () => {
  it("before any are set, are the defaults (Breakfast before 10:30 ... Dessert from 20:30)", async () => {
    expect(await h.call(h.A, "mealWindows", {})).toEqual(DEFAULTS);
  });

  it("a Member reads back the windows they put", async () => {
    expect(await h.call(h.A, "putMealWindows", { input: MINE })).toEqual(MINE);
    expect(await h.call(h.A, "mealWindows", {})).toEqual(MINE);
  });

  it("are stored per Member, in that Member's partition, apart from goals", async () => {
    await h.call(h.A, "putMealWindows", { input: MINE });
    expect(await h.call(h.B, "mealWindows", {})).toEqual(DEFAULTS);
    expect(h.db.dump().map((r) => `${r.PK}/${r.SK}`)).toEqual(["MEMBER#member-a/MEAL_WINDOWS"]);
    expect((await h.call(h.A, "goals", {})).water).toBe(8);
  });

  it("putting windows replaces them (last write wins)", async () => {
    await h.call(h.A, "putMealWindows", { input: MINE });
    await h.call(h.A, "putMealWindows", { input: { ...MINE, dinner: "19:00" } });
    expect(await h.call(h.A, "mealWindows", {})).toEqual({ ...MINE, dinner: "19:00" });
  });

  it("refuses bad times, missing Meals or two Meals starting at once, and writes nothing", async () => {
    for (const input of [{ ...MINE, lunch: "24:00" }, { ...MINE, snack: "3pm" }, { breakfast: "06:00" }, { ...MINE, dessert: MINE.dinner }]) {
      await expect(h.call(h.A, "putMealWindows", { input })).rejects.toThrow(/^ValidationError/);
    }
    expect(h.db.dump()).toEqual([]);
  });

  it("are refused to an unknown username", async () => {
    await expect(h.call({ userId: "x", username: "stranger" }, "mealWindows", {})).rejects.toThrow("Forbidden");
  });
});
