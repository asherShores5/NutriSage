// Ticket 08, Week and Trends parity: seeded Days drive the streak (an unlogged today doesn't break
// it), daily averages over logged Days, and the week total against goal x7; logging today extends
// the streak; Trends charts any metric over the last 30 Days, with weight gaps.
import { expect } from "playwright/test";
import { lastDays } from "../shared/src/week";
import { launch, todayKey } from "./app";
import { graphql } from "./backend";
import { checklist, lastCall, tab } from "./lib";

const TOKEN = "fake-id.aubyn";
const today = todayKey();
const ago = (n: number) => lastDays(today, n + 1)[0];
const nutrition = (calories: number, protein: number) => ({ carbs: 0, protein, fat: 0, fiber: 0, sodium: 0, iron: 0, calories });

async function putDay(date: string, calories: number, protein: number, weight: number | null = null) {
  const r = await graphql(TOKEN, "mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `e-${date}`, meal: "lunch", name: "Seeded lunch", nutrition: nutrition(calories, protein) }], water: 3, weight },
  });
  if (r.errors) throw new Error(JSON.stringify(r.errors));
}

// Week (last 7 Days incl. today): today unlogged, 1-3 Days ago logged (streak 3), 4 ago unlogged,
// 5 ago logged. 9 ago is outside the week. Logged-Day average: (1800+2200+2000+1600)/4 = 1900 cal.
await putDay(ago(1), 1800, 90);
await putDay(ago(2), 2200, 110, 170.2);
await putDay(ago(3), 2000, 100);
await putDay(ago(5), 1600, 80, 171);
await putDay(ago(9), 9999, 999);
// A Day with water but no Entries isn't logged.
await graphql(TOKEN, "mutation($input: DayInput!) { putDay(input: $input) { date } }", { input: { date: ago(4), entries: [], water: 6, weight: null } });
await graphql(TOKEN, "mutation($input: GoalsInput!) { putGoals(input: $input) { calories } }", {
  input: { carbs: 0, protein: 100, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 2000, water: 8 },
});

const app = await launch();
const c = checklist("week");
const p = await app.open("aubyn");
c.watch(p);
await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();

const avg = p.getByRole("region", { name: "Daily average" });
const total = p.getByRole("region", { name: "Week total" });
const value = (region: typeof avg, key: string) => region.locator(`[data-nutrient="${key}"] .bar-value`);

await c.check("the streak counts 3 Days: an unlogged today doesn't break it", async () => {
  await tab(p, "Week");
  await expect(p.getByRole("region", { name: "Streak" })).toContainText("🔥 3");
  await expect(p.getByRole("region", { name: "Streak" })).toContainText("days logged in a row");
});

await c.check("daily averages are over the 4 logged Days only", async () => {
  await expect(p.getByText("Averaged over 4 logged Days this week.")).toBeVisible();
  await expect(value(avg, "calories")).toHaveText("1900 / 2000 cal");
  await expect(value(avg, "protein")).toHaveText("95 / 100 g");
});

await c.check("the week total is against goal x7, for the 7 Days ending today", async () => {
  await expect(value(total, "calories")).toHaveText("7600 / 14000 cal");
  await expect(value(total, "protein")).toHaveText("380 / 700 g");
  await expect(p.getByText(`${ago(6)} → ${today}`)).toBeVisible();
});

await c.check("logging today extends the streak and the averages", async () => {
  await tab(p, "Today");
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill("Banana");
  await form.getByLabel("Calories").fill("1900");
  await form.getByLabel("Protein").fill("95");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Banana")).toBeVisible();
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.date).toBe(today); // the Day write landed
  await tab(p, "Week");
  await expect(p.getByRole("region", { name: "Streak" })).toContainText("🔥 4");
  await expect(p.getByText("Averaged over 5 logged Days this week.")).toBeVisible();
  await expect(value(total, "calories")).toHaveText("9500 / 14000 cal");
});

await c.check("Trends charts calories over the last 30 Days, one dot per logged Day", async () => {
  await tab(p, "Trends");
  const chart = p.getByRole("img", { name: "Calories, last 30 days" });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".trend-dot")).toHaveCount(6); // 9, 5, 3, 2, 1 Days ago and today
  await expect(p.getByText("Last 30 days · 6 logged · max 9999")).toBeVisible();
  await expect(chart.locator(`.trend-dot[data-date="${ago(9)}"]`)).toHaveAttribute("data-value", "9999");
});

await c.check("Trends switches metric; weight shows only the Days it was logged", async () => {
  await p.getByLabel("Metric").selectOption("weight");
  const chart = p.getByRole("img", { name: "Weight, last 30 days" });
  await expect(chart.locator(".trend-dot")).toHaveCount(2);
  await expect(p.getByText("Last 30 days · 2 logged · max 171")).toBeVisible();
  await p.getByLabel("Metric").selectOption("water");
  await expect(p.getByRole("img", { name: "Water, last 30 days" }).locator(".trend-dot")).toHaveCount(7); // 3 cups on the 5 seeded Days, 6 cups 4 Days ago, 0 today (logged, so a real 0)
});

await p.context().close();
await app.close();
c.report();
