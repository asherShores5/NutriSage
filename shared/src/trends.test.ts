import { describe, expect, it } from "vitest";
import { TREND_METRICS, defaultYMode, trendBounds, trendGoal, trendSegments, trendSeries, trendSummary } from "./trends";

const e = (carbs: number, calories: number) => ({ nutrition: { carbs, calories } });

describe("trend metrics", () => {
  it("are calories, weight, water, then every other nutrient, as in the old picker", () => {
    expect(TREND_METRICS.map((m) => m.key)).toEqual(["calories", "weight", "water", "carbs", "protein", "fat", "fiber", "sodium", "iron"]);
  });
});

describe("trendSeries: unlogged Days are no data", () => {
  const days = {
    "2026-03-01": { entries: [e(10.4, 100.6), e(5, 50)], water: 4, weight: 171.4 },
    "2026-03-02": { entries: [], water: 3, weight: null },
    "2026-03-03": { entries: [e(20, 200)], water: null, weight: 0 },
  };
  const range = { from: "2026-02-28", to: "2026-03-04" };

  it("has one point per date in the range, oldest first", () => {
    expect(trendSeries(days, "calories", range).map((p) => p.date)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]);
  });

  it("a nutrient is the Day's rounded total, and no data on a Day without Entries", () => {
    expect(trendSeries(days, "calories", range).map((p) => p.value)).toEqual([null, 151, null, 200, null]);
    expect(trendSeries(days, "carbs", range).map((p) => p.value)).toEqual([null, 15, null, 20, null]);
  });

  it("water is cups on a Day with water or Entries (a logged Day with no water is a real 0), else no data", () => {
    expect(trendSeries(days, "water", range).map((p) => p.value)).toEqual([null, 4, 3, 0, null]);
  });

  it("weight is no data when not logged, including the old app's 0", () => {
    expect(trendSeries(days, "weight", range).map((p) => p.value)).toEqual([null, 171.4, null, null, null]);
  });
});

describe("trendSeries: today is in progress", () => {
  const days = { "2026-03-01": { entries: [e(1, 100)] }, "2026-03-02": { entries: [e(1, 40)] } };
  const range = { from: "2026-03-01", to: "2026-03-02" };

  it("flags only today's point, keeping its value", () => {
    const s = trendSeries(days, "calories", range, { today: "2026-03-02" });
    expect(s.map((p) => [p.value, p.inProgress])).toEqual([[100, false], [40, true]]);
  });

  it("flags nothing when today is outside the range or not given", () => {
    expect(trendSeries(days, "calories", range, { today: "2026-03-05" }).some((p) => p.inProgress)).toBe(false);
    expect(trendSeries(days, "calories", range).some((p) => p.inProgress)).toBe(false);
  });
});

const pts = (...values: (number | null)[]) => values.map((value, i) => ({ date: `2026-03-0${i + 1}`, value, inProgress: false }));

describe("trendBounds", () => {
  it("zero mode runs from 0 to the highest point", () => {
    expect(trendBounds(pts(100, null, 250), "zero")).toEqual({ min: 0, max: 250 });
  });

  it("fit mode runs from the lowest to the highest point (small weight swings stay visible)", () => {
    expect(trendBounds(pts(171.4, null, 169.8), "fit")).toEqual({ min: 169.8, max: 171.4 });
  });

  it("never has a max under 1, and with no points is 0..1", () => {
    expect(trendBounds(pts(0, 0), "zero")).toEqual({ min: 0, max: 1 });
    expect(trendBounds(pts(null, null), "fit")).toEqual({ min: 0, max: 1 });
  });

  it("manual mode uses the Member's min and max as given, even when points fall outside", () => {
    expect(trendBounds(pts(100, null, 250), "manual", { manual: { min: 150, max: 200 } })).toEqual({ min: 150, max: 200 });
  });

  it("manual mode with a blank side keeps the zero-mode bound for that side", () => {
    expect(trendBounds(pts(100, null, 250), "manual", { manual: { min: 150, max: null } })).toEqual({ min: 150, max: 250 });
    expect(trendBounds(pts(100, null, 250), "manual", { manual: { min: null, max: 300 } })).toEqual({ min: 0, max: 300 });
  });

  it("manual mode ignores a min that isn't below the max (falls back to zero mode)", () => {
    expect(trendBounds(pts(100, null, 250), "manual", { manual: { min: 200, max: 200 } })).toEqual({ min: 0, max: 250 });
    expect(trendBounds(pts(100, null, 250), "manual", { manual: { min: 300, max: null } })).toEqual({ min: 0, max: 250 });
  });

  it("weight defaults to fit, everything else to zero", () => {
    expect(defaultYMode("weight")).toBe("fit");
    expect(defaultYMode("calories")).toBe("zero");
    expect(defaultYMode("water")).toBe("zero");
  });
});

describe("goal line", () => {
  const goals = { carbs: 200, protein: 0, fat: 60, fiber: 30, sodium: 2300, iron: 10, calories: 2000, water: 8 };

  it("is the Member's goal for a nutrient, and the water goal for water", () => {
    expect(trendGoal(goals, "calories")).toBe(2000);
    expect(trendGoal(goals, "water")).toBe(8);
  });

  it("has none for weight (no weight goal), a goal of 0 (no goal), or before goals load", () => {
    expect(trendGoal(goals, "weight")).toBeNull();
    expect(trendGoal(goals, "protein")).toBeNull();
    expect(trendGoal(undefined, "calories")).toBeNull();
  });

  it("stays on screen in zero and fit mode: the bounds stretch to reach it", () => {
    expect(trendBounds(pts(1500, null, 1800), "zero", { goal: 2000 })).toEqual({ min: 0, max: 2000 });
    expect(trendBounds(pts(1500, null, 1800), "fit", { goal: 1200 })).toEqual({ min: 1200, max: 1800 });
    expect(trendBounds(pts(1500, null, 1800), "fit", { goal: 1600 })).toEqual({ min: 1500, max: 1800 });
    expect(trendBounds(pts(null, null), "zero", { goal: 8 })).toEqual({ min: 0, max: 8 });
  });

  it("doesn't move manual bounds (the line is drawn only when it falls inside them)", () => {
    expect(trendBounds(pts(1500, 1800), "manual", { goal: 2000, manual: { min: 1400, max: 1900 } })).toEqual({ min: 1400, max: 1900 });
  });
});

describe("trendSummary", () => {
  it("counts points with data (a logged 0 counts) and their max", () => {
    expect(trendSummary(pts(0, 151, null, 200))).toEqual({ logged: 3, max: 200 });
  });

  it("is 0 logged with no max when no point has data", () => {
    expect(trendSummary(pts(null, null))).toEqual({ logged: 0, max: null });
  });
});

describe("trendSegments", () => {
  it("joins neighbouring points with solid segments and bridges no-data Days with a bridged one", () => {
    expect(trendSegments(pts(null, 100, 120, null, null, 90, null))).toEqual([
      { from: 1, to: 2, bridged: false, inProgress: false },
      { from: 2, to: 5, bridged: true, inProgress: false },
    ]);
  });

  it("has none with fewer than two points with data", () => {
    expect(trendSegments(pts(null, 5, null))).toEqual([]);
    expect(trendSegments(pts(null, null))).toEqual([]);
  });

  it("flags the segment into today as in progress", () => {
    const points = pts(100, null, 40).map((p, i) => ({ ...p, inProgress: i === 2 }));
    expect(trendSegments(points)).toEqual([{ from: 0, to: 2, bridged: true, inProgress: true }]);
  });

  it("ends at the last Day with data when today has none", () => {
    const points = pts(100, 110, null).map((p, i) => ({ ...p, inProgress: i === 2 }));
    expect(trendSegments(points)).toEqual([{ from: 0, to: 1, bridged: false, inProgress: false }]);
  });
});
