// Ticket 20, Trends gaps: unlogged Days are no data (no dot, never 0), the line bridges them with
// a dashed segment, and today is in progress (hollow dot, faded segment into it).
import { expect } from "playwright/test";
import { lastDays } from "../shared/src/week";
import { launch, todayKey } from "./app";
import { graphql } from "./backend";
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

// Logged 10, 9 and 6 Days ago and today (half-logged). 8-7 and 5-1 Days ago are unlogged.
await putDay(ago(10), 2100);
await putDay(ago(9), 1900);
await putDay(ago(6), 2000);
await putDay(today, 600);

const app = await launch();
const c = checklist("trends");
const p = await app.open("aubyn");
c.watch(p);
await tab(p, "Trends");
const chart = p.getByRole("img", { name: "Calories, last 30 days" });

await c.check("unlogged Days are no data: one dot per logged Day, none at 0", async () => {
  await expect(chart.locator(".trend-dot")).toHaveCount(4);
  await expect(chart.locator(`.trend-dot[data-date="${ago(7)}"]`)).toHaveCount(0);
  await expect(chart.locator('.trend-dot[data-value="0"]')).toHaveCount(0);
  await expect(p.getByText("Last 30 days · 4 logged · max 2100")).toBeVisible();
});

await c.check("the line bridges gaps with dashed segments and stays solid between neighbouring Days", async () => {
  await expect(chart.locator(".trend-line")).toHaveCount(3); // 10->9 solid, 9->6 and 6->today bridged
  await expect(chart.locator(".trend-line.trend-bridge")).toHaveCount(2);
  await expect(chart.locator(".trend-line:not(.trend-bridge)")).toHaveCount(1);
  await expect(p.getByText("Dashed: Days with no data. Hollow dot: today, in progress.")).toBeVisible();
});

await c.check("today is in progress: hollow dot, faded segment into it, axis says Today", async () => {
  await expect(chart.locator(`.trend-dot.trend-today[data-date="${today}"]`)).toHaveCount(1);
  await expect(chart.locator(".trend-dot.trend-today")).toHaveCount(1);
  await expect(chart.locator(".trend-line.trend-today")).toHaveCount(1);
  await expect(chart.getByText("Today", { exact: true })).toBeVisible();
  await shot(p, "trends-gaps");
});

await p.context().close();
await app.close();
c.report();
