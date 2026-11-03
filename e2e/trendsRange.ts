// Ticket 21, Trends date range: presets (7d, 30d, 90d, 1y, All) and a custom start and end. Ranges
// over ~90 days plot weekly averages of logged Days. Every range is one `days` range query.
import { expect, type Page } from "playwright/test";
import { lastDays } from "../shared/src/week";
import { launch, todayKey } from "./app";
import { calls, graphql } from "./backend";
import { checklist, shot, tab } from "./lib";

const TOKEN = "fake-id.aubyn";
const today = todayKey();
const ago = (n: number) => lastDays(today, n + 1)[0];

async function putDay(date: string, calories: number) {
  const r = await graphql(TOKEN, "mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `e-${date}`, meal: "lunch", name: "Seeded lunch", nutrition: { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories } }], water: 0, weight: null },
  });
  if (r.errors) throw new Error(JSON.stringify(r.errors));
}

// One logged Day each, 3, 20, 60, 200 and 500 Days ago (all in different weeks); 3 and 4 Days ago
// share a week, so the weekly point there averages 1800 and 2200 to 2000.
for (const [n, cal] of [[3, 1800], [4, 2200], [20, 1500], [60, 2500], [200, 1700], [500, 2100]] as const) await putDay(ago(n), cal);

const app = await launch();
const c = checklist("trendsRange");
const p = await app.open("aubyn");
c.watch(p);
await tab(p, "Trends");
const range = p.getByRole("group", { name: "Range" });
const dots = (name: string) => p.getByRole("img", { name }).locator(".trend-dot");

/** Click a preset and return the `days` queries it sent. */
async function pick(page: Page, name: string, chart: string) {
  const before = calls.length;
  await range.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("img", { name: chart })).toBeVisible();
  return calls.slice(before).filter((x) => x.field === "days").map((x) => x.args as { from: string; to: string });
}

await c.check("opens on 30d: daily dots for the Days logged in the last 30", async () => {
  await expect(range.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  await expect(dots("Calories, last 30 days")).toHaveCount(3);
});

await c.check("7d and 90d are daily over their Days, one range query each", async () => {
  expect(await pick(p, "7d", "Calories, last 7 days")).toEqual([{ from: ago(6), to: today }]);
  await expect(dots("Calories, last 7 days")).toHaveCount(2);
  expect(await pick(p, "90d", "Calories, last 90 days")).toEqual([{ from: ago(89), to: today }]);
  await expect(dots("Calories, last 90 days")).toHaveCount(4);
  await expect(p.getByText("Last 90 days · 4 logged · max 2500")).toBeVisible();
});

await c.check("1y plots weekly averages of logged Days, from one range query", async () => {
  expect(await pick(p, "1y", "Calories, last year")).toEqual([{ from: ago(364), to: today }]);
  const d = dots("Calories, last year");
  await expect(d).toHaveCount(4); // weeks holding 3+4, 20, 60 and 200 Days ago
  await expect(p.getByRole("img", { name: "Calories, last year" }).locator('.trend-dot[data-value="2000"]')).toHaveCount(1); // (1800 + 2200) / 2
  await expect(p.getByText("Last year · weekly averages · 4 weeks logged · max 2500")).toBeVisible();
  await shot(p, "trends-range-1y");
});

await c.check("All starts at the first Day logged, weekly, still one range query", async () => {
  const q = await pick(p, "All", "Calories, all time");
  expect(q.length).toBe(1);
  expect(q[0].to).toBe(today);
  const d = dots("Calories, all time");
  await expect(d).toHaveCount(5);
  await expect(d.first()).toHaveAttribute("data-date", ago(500));
  await expect(p.getByText("All time · weekly averages · 5 weeks logged · max 2500")).toBeVisible();
});

await c.check("a custom start and end charts just those Days; a start after the end is refused", async () => {
  await range.getByRole("button", { name: "Custom" }).click();
  await p.getByLabel("Start", { exact: true }).fill(ago(25));
  await p.getByLabel("End", { exact: true }).fill(ago(15));
  const name = `Calories, ${ago(25)} to ${ago(15)}`;
  await expect(dots(name)).toHaveCount(1);
  await expect(dots(name).first()).toHaveAttribute("data-date", ago(20));
  await p.getByLabel("Start", { exact: true }).fill(ago(10));
  await expect(p.getByText("Start must be on or before end.")).toBeVisible();
  await expect(dots(name)).toHaveCount(1); // keeps the last good range
  await shot(p, "trends-range-custom");
});

await c.check("back to a preset leaves Custom", async () => {
  await pick(p, "30d", "Calories, last 30 days");
  await expect(p.getByLabel("Start", { exact: true })).toHaveCount(0);
  await expect(dots("Calories, last 30 days")).toHaveCount(3);
});

await p.context().close();
await app.close();
c.report();
