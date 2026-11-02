import { describe, expect, it } from "vitest";
import { TREND_METRICS, defaultYMode, trendBounds, trendSeries, trendSummary } from "./trends";

const e = (carbs: number, calories: number) => ({ nutrition: { carbs, calories } });

describe("trend metrics", () => {
  it("are calories, weight, water, then every other nutrient, as in the old picker", () => {
    expect(TREND_METRICS.map((m) => m.key)).toEqual(["calories", "weight", "water", "carbs", "protein", "fat", "fiber", "sodium", "iron"]);
  });
});

describe("trendSeries (parity with the old 30-day chart)", () => {
  const days = {
    "2026-03-01": { entries: [e(10.4, 100.6), e(5, 50)], water: 4, weight: 171.4 },
    "2026-03-03": { entries: [e(20, 200)], water: null, weight: 0 },
  };
  const range = { from: "2026-02-28", to: "2026-03-03" };

  it("has one point per date in the range, oldest first", () => {
    expect(trendSeries(days, "calories", range).map((p) => p.date)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  it("a nutrient is the Day's rounded total, and 0 on an unlogged Day (the old behaviour; ticket 20 changes it)", () => {
    expect(trendSeries(days, "calories", range).map((p) => p.value)).toEqual([0, 151, 0, 200]);
    expect(trendSeries(days, "carbs", range).map((p) => p.value)).toEqual([0, 15, 0, 20]);
  });

  it("water is cups, null counting as 0", () => {
    expect(trendSeries(days, "water", range).map((p) => p.value)).toEqual([0, 4, 0, 0]);
  });

  it("weight is a gap (null) when not logged, including the old app's 0", () => {
    expect(trendSeries(days, "weight", range).map((p) => p.value)).toEqual([null, 171.4, null, null]);
  });
});

const pts = (...values: (number | null)[]) => values.map((value, i) => ({ date: `2026-03-0${i + 1}`, value }));

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

  it("weight defaults to fit, everything else to zero", () => {
    expect(defaultYMode("weight")).toBe("fit");
    expect(defaultYMode("calories")).toBe("zero");
    expect(defaultYMode("water")).toBe("zero");
  });
});

describe("trendSummary", () => {
  it("counts points above 0 and their max", () => {
    expect(trendSummary(pts(0, 151, null, 200))).toEqual({ logged: 2, max: 200 });
  });

  it("is 0 logged with no max when nothing is above 0", () => {
    expect(trendSummary(pts(0, null))).toEqual({ logged: 0, max: null });
  });
});
