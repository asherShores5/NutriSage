import { describe, expect, it } from "vitest";
import { MEALS } from "./day";
import { guestSeed } from "./guest";

describe("a Guest's demo data", () => {
  const seed = guestSeed("2026-03-03");

  it("has demo Days across the last 10 days, with a few gaps, ending today", () => {
    expect(seed.days.map((d) => d.date)).toEqual([
      "2026-02-22", "2026-02-23", "2026-02-25", "2026-02-26", "2026-02-27", "2026-03-01", "2026-03-02", "2026-03-03",
    ]);
  });

  it("each demo Day has three Entries in real Meals, water and a weight", () => {
    const today = seed.days.at(-1)!;
    expect(today.entries.map((e) => [e.name, e.meal])).toEqual([
      ["2 eggs and toast", "breakfast"],
      ["Grilled chicken salad", "lunch"],
      ["Spaghetti with meat sauce", "dinner"],
    ]);
    expect(today.entries[0].nutrition).toEqual({ carbs: 30, protein: 18, fat: 14, fiber: 3, sodium: 380, iron: 2.5, calories: 330 });
    expect(today).toMatchObject({ water: 4, weight: 165 });
    for (const d of seed.days) {
      expect(d.entries).toHaveLength(3);
      for (const e of d.entries) expect(MEALS).toContain(e.meal);
    }
    expect(new Set(seed.days.flatMap((d) => d.entries.map((e) => e.id))).size).toBe(24);
  });

  it("has a demo Library of 8 Foods with their serving nutrition", () => {
    expect(seed.library.map((f) => f.name)).toEqual([
      "2 eggs and toast", "Greek yogurt with berries", "Grilled chicken salad", "Turkey sandwich",
      "Salmon with rice and broccoli", "Spaghetti with meat sauce", "Apple", "Handful of almonds",
    ]);
    expect(seed.library.find((f) => f.name === "Apple")).toMatchObject({ nutrition: { carbs: 25, calories: 95 } });
  });

  it("has demo goals for every nutrient and water", () => {
    expect(seed.goals).toEqual({ carbs: 220, protein: 130, fat: 70, fiber: 30, sodium: 2300, iron: 18, calories: 2000, water: 8 });
  });

  it("is the same every time for the same day", () => {
    expect(guestSeed("2026-03-03")).toEqual(seed);
  });
});
