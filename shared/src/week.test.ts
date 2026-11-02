import { describe, expect, it } from "vitest";
import { datesBetween, daysByDate, streak, lastDays, sumWeek, weekGoals, weekKeys, weekStats } from "./week";

// Cases ported from the old docs/macros.test.js (GitHub main 13e8f12).
describe("lastDays and weekKeys", () => {
  it("datesBetween lists from..to inclusive, oldest first, and nothing when from > to", () => {
    expect(datesBetween("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(datesBetween("2026-03-01", "2026-03-01")).toEqual(["2026-03-01"]);
    expect(datesBetween("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("lastDays lists the n dates ending at endKey, oldest first", () => {
    expect(lastDays("2026-03-03", 3)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(lastDays("2026-03-03", 30)).toHaveLength(30);
  });

  it("weekKeys is the 7 dates ending at endKey, across a month boundary", () => {
    expect(weekKeys("2026-03-03")).toEqual([
      "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03",
    ]);
  });
});

const entry = (protein: number, calories: number) => ({ nutrition: { protein, calories } });
const DAYS = {
  "2026-03-01": { entries: [entry(10, 100)] },
  "2026-03-03": { entries: [entry(20, 200)] },
  "2026-02-20": { entries: [entry(999, 999)] }, // outside the week
};

describe("sumWeek and weekStats", () => {
  it("sumWeek totals the 7 Days ending at endKey and ignores older ones", () => {
    const t = sumWeek(DAYS, "2026-03-03");
    expect(t.protein).toBe(30);
    expect(t.calories).toBe(300);
  });

  it("weekStats averages over logged Days only", () => {
    const s = weekStats(DAYS, "2026-03-03");
    expect(s.logged).toBe(2);
    expect(s.days).toBe(7);
    expect(s.avg.calories).toBe(150);
    expect(s.avg.protein).toBe(15);
    expect(s.total.calories).toBe(300);
  });

  it("weekStats with no Days has averages of 0, not NaN", () => {
    const s = weekStats({}, "2026-03-03");
    expect(s.logged).toBe(0);
    expect(s.avg.calories).toBe(0);
  });

  it("a Day with water or weight but no Entries is not a logged Day", () => {
    expect(weekStats({ "2026-03-03": { entries: [] } }, "2026-03-03").logged).toBe(0);
  });
});

describe("weekGoals", () => {
  it("is each nutrient goal x7, water dropped", () => {
    const g = weekGoals({ carbs: 200, protein: 100, fat: 60, fiber: 30, sodium: 2300, iron: 10, calories: 2000, water: 8 });
    expect(g).toEqual({ carbs: 1400, protein: 700, fat: 420, fiber: 210, sodium: 16100, iron: 70, calories: 14000 });
  });

  it("is all 0 (no goals) before goals load", () => {
    expect(weekGoals(undefined).calories).toBe(0);
  });
});

describe("daysByDate", () => {
  it("indexes a list of Days by date", () => {
    const a = { date: "2026-03-01", entries: [] };
    const b = { date: "2026-03-02", entries: [] };
    expect(daysByDate([a, b])).toEqual({ "2026-03-01": a, "2026-03-02": b });
  });
});

describe("streak", () => {
  const run = { "2026-03-01": { entries: [entry(1, 1)] }, "2026-03-02": { entries: [entry(1, 1)] }, "2026-03-03": { entries: [entry(1, 1)] } };

  it("counts consecutive logged Days ending at endKey", () => {
    expect(streak(run, "2026-03-03")).toBe(3);
  });

  it("an unlogged today doesn't break it (counts from yesterday)", () => {
    expect(streak(run, "2026-03-04")).toBe(3);
  });

  it("a full missed Day ends it", () => {
    expect(streak(run, "2026-03-05")).toBe(0);
  });

  it("a Day with no Entries is not logged", () => {
    expect(streak({ "2026-03-02": { entries: [] } }, "2026-03-02")).toBe(0);
  });

  it("runs across a month boundary", () => {
    expect(streak({ "2026-02-28": { entries: [entry(1, 1)] }, "2026-03-01": { entries: [entry(1, 1)] } }, "2026-03-01")).toBe(2);
  });
});
