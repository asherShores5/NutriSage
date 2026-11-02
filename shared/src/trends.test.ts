import { describe, expect, it } from "vitest";
import { TREND_METRICS, TREND_PRESETS, customRange, defaultYMode, presetRange, trendBounds, trendBucket, trendSegments, trendSeries, trendSummary } from "./trends";

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

  it("weight defaults to fit, everything else to zero", () => {
    expect(defaultYMode("weight")).toBe("fit");
    expect(defaultYMode("calories")).toBe("zero");
    expect(defaultYMode("water")).toBe("zero");
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

describe("trendSeries: weekly buckets average logged Days only", () => {
  // 14 Days, 2026-03-01 (Sun) .. 2026-03-14 (Sat). Buckets end at the range's end: 03-08..03-14, 03-01..03-07.
  const range = { from: "2026-03-01", to: "2026-03-14" };
  const days = {
    "2026-03-02": { entries: [e(0, 2000)], weight: 170 },
    "2026-03-03": { entries: [e(0, 1000)], weight: 171 },
    "2026-03-04": { entries: [], weight: 0 }, // unlogged: not averaged in as 0
    "2026-03-13": { entries: [e(0, 1801)], weight: 169.25 },
  };

  it("has one point per 7 Days, oldest first, each from its first Day to its last", () => {
    const s = trendSeries(days, "calories", range, { bucket: "week" });
    expect(s.map((p) => [p.date, p.end])).toEqual([["2026-03-01", "2026-03-07"], ["2026-03-08", "2026-03-14"]]);
  });

  it("each point is the average over its logged Days, never counting unlogged Days as 0", () => {
    expect(trendSeries(days, "calories", range, { bucket: "week" }).map((p) => p.value)).toEqual([1500, 1801]);
    expect(trendSeries(days, "weight", range, { bucket: "week" }).map((p) => p.value)).toEqual([170.5, 169.3]);
  });
});

describe("trendSeries: weekly bucket edges", () => {
  const days = { "2026-03-01": { entries: [e(0, 900)] }, "2026-03-10": { entries: [e(0, 600)] } };

  it("the oldest bucket is shorter when the range isn't whole weeks, and a bucket with no data is null", () => {
    const s = trendSeries(days, "calories", { from: "2026-02-28", to: "2026-03-15" }, { bucket: "week" });
    expect(s.map((p) => [p.date, p.end, p.value])).toEqual([
      ["2026-02-28", "2026-03-01", 900],
      ["2026-03-02", "2026-03-08", null],
      ["2026-03-09", "2026-03-15", 600],
    ]);
  });

  it("flags the bucket holding today as in progress, and the gap before it is bridged", () => {
    const s = trendSeries(days, "calories", { from: "2026-02-28", to: "2026-03-15" }, { bucket: "week", today: "2026-03-15" });
    expect(s.map((p) => p.inProgress)).toEqual([false, false, true]);
    expect(trendSegments(s)).toEqual([{ from: 0, to: 2, bridged: true, inProgress: true }]);
  });
});

describe("trendBucket: ranges over about 90 days are weekly", () => {
  it("is daily up to 90 Days and weekly from 91", () => {
    expect(trendBucket({ from: "2026-01-01", to: "2026-03-31" })).toBe("day"); // 90 Days
    expect(trendBucket({ from: "2025-12-31", to: "2026-03-31" })).toBe("week"); // 91 Days
  });
});

describe("range presets", () => {
  it("are 7d, 30d, 90d, 1y and All", () => {
    expect(TREND_PRESETS.map((p) => p.key)).toEqual(["7d", "30d", "90d", "1y", "all"]);
  });

  it("each ends today; 7d/30d/90d are that many Days, 1y is 365, and only 1y is weekly", () => {
    const today = "2026-03-31";
    expect(presetRange("7d", today)).toEqual({ from: "2026-03-25", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2026-03-02", to: today });
    expect(presetRange("90d", today)).toEqual({ from: "2026-01-01", to: today });
    expect(presetRange("1y", today)).toEqual({ from: "2025-04-01", to: today });
    expect(["7d", "30d", "90d", "1y"].map((k) => trendBucket(presetRange(k as "7d", today)))).toEqual(["day", "day", "day", "week"]);
  });

  it("All starts at the first Day logged, or is just today with nothing logged", () => {
    expect(presetRange("all", "2026-03-31", "2024-06-15")).toEqual({ from: "2024-06-15", to: "2026-03-31" });
    expect(presetRange("all", "2026-03-31")).toEqual({ from: "2026-03-31", to: "2026-03-31" });
  });
});

describe("customRange", () => {
  const today = "2026-03-31";
  it("is the start and end as picked", () => {
    expect(customRange("2026-01-05", "2026-02-10", today)).toEqual({ from: "2026-01-05", to: "2026-02-10" });
  });

  it("rejects a start after the end, a missing or bad date, and an end after today, with a message", () => {
    expect(customRange("2026-02-10", "2026-01-05", today)).toEqual({ error: "Start must be on or before end." });
    expect(customRange("", "2026-01-05", today)).toEqual({ error: "Pick a start and an end." });
    expect(customRange("2026-02-30", "2026-03-01", today)).toEqual({ error: "Pick a start and an end." });
    expect(customRange("2026-03-01", "2026-04-01", today)).toEqual({ error: "End can't be after today." });
  });
});
