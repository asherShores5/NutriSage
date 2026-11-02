// Ticket 23, Trends second metric: overlay a second metric on a right-hand Y-axis with its own
// bounds (e.g. calories vs weight), its own color and a legend. Same range and weekly buckets as
// the primary; the goal line stays with the primary metric.
import { expect } from "playwright/test";
import { lastDays } from "../shared/src/week";
import { launch, todayKey } from "./app";
import { graphql } from "./backend";
import { checklist, shot, tab } from "./lib";

const TOKEN = "fake-id.aubyn";
const today = todayKey();
const ago = (n: number) => lastDays(today, n + 1)[0];

async function gql(query: string, variables: object) {
  const r = await graphql(TOKEN, query, variables);
  if (r.errors) throw new Error(JSON.stringify(r.errors));
}
const putDay = (date: string, calories: number, weight: number | null) =>
  gql("mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `e-${date}`, meal: "lunch", name: "Seeded lunch", nutrition: { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories } }], water: 4, weight },
  });

await gql("mutation($input: GoalsInput!) { putGoals(input: $input) { calories } }", {
  input: { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 2200, water: 8 },
});
await putDay(ago(6), 1500, 171.4);
await putDay(ago(4), 1800, null);
await putDay(ago(2), 1700, 170.2);
await putDay(ago(120), 2000, 180); // inside 1y: weekly buckets

const app = await launch();
const c = checklist("trends-second");
const p = await app.open("aubyn");
c.watch(p);
await tab(p, "Trends");
const second = p.getByLabel("Compare with");
const overlay = p.getByRole("img", { name: "Calories and Weight, last 30 days" });
const right = () => overlay.locator(".trend-second text.trend-label").allTextContents();

await c.check("no second metric by default: one series, no legend", async () => {
  await expect(second).toHaveValue("");
  await expect(p.getByRole("img", { name: "Calories, last 30 days" }).locator(".trend-second")).toHaveCount(0);
  await expect(p.getByRole("list", { name: "Legend" })).toHaveCount(0);
});

await c.check("the second metric can't be the primary one", async () => {
  expect(await second.locator("option").allTextContents()).not.toContain("Calories");
});

await c.check("weight overlays on a right-hand axis with its own bounds, fit to its data", async () => {
  await second.selectOption("weight");
  await expect(overlay.locator(".trend-second .trend-dot")).toHaveCount(2);
  await expect(overlay.locator(".trend-second .trend-dot[data-value='171.4']")).toHaveCount(1);
  expect(await right()).toEqual(expect.arrayContaining(["171", "170"])); // right axis: weight's own fit bounds
  await expect(p.getByLabel("Right axis scale")).toHaveValue("fit");
  // Left axis unchanged: calories from 0 to the goal.
  await expect(p.getByLabel("Y-axis scale")).toHaveValue("zero");
  expect(await overlay.locator(":scope > text.trend-label").allTextContents()).toContain("2200");
  await shot(p, "trends-second-weight");
});

await c.check("a legend names each series and its axis", async () => {
  const legend = p.getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("listitem")).toHaveText(["Calories (left axis)", "Weight (right axis)"]);
});

await c.check("the goal line stays with the primary metric", async () => {
  await expect(overlay.locator(".trend-goal")).toHaveCount(1);
  await expect(overlay.locator('.trend-goal[data-goal="2200"]')).toHaveCount(1);
});

await c.check("the second series has its own color, different from the primary's", async () => {
  const color = (sel: string) => overlay.locator(sel).first().evaluate((el) => getComputedStyle(el).fill);
  expect(await color(".trend-second .trend-dot")).not.toBe(await color(":scope > g:not(.trend-second) .trend-dot"));
});

await c.check("the right axis can start at 0", async () => {
  await p.getByLabel("Right axis scale").selectOption("zero");
  expect(await right()).toEqual(expect.arrayContaining(["171"]));
  expect(await right()).not.toContain("170");
  await p.getByLabel("Right axis scale").selectOption("fit");
});

await c.check("the overlay follows the range and weekly buckets", async () => {
  await p.getByRole("button", { name: "1y" }).click();
  const year = p.getByRole("img", { name: "Calories and Weight, last year" });
  await expect(year.locator(".trend-second .trend-dot")).toHaveCount(2); // the week 120 Days ago, and this week (6 and 2 Days ago, averaged)
  await expect(year.locator(".trend-second .trend-dot[data-value='170.8']")).toHaveCount(1);
  await shot(p, "trends-second-1y");
  await p.getByRole("button", { name: "30d" }).click();
});

await c.check("picking the second metric as the primary drops the overlay", async () => {
  await p.getByLabel("Metric").selectOption("weight");
  await expect(second).toHaveValue("");
  await expect(p.getByRole("list", { name: "Legend" })).toHaveCount(0);
});

await c.check("None removes the overlay", async () => {
  await second.selectOption("calories");
  await expect(p.getByRole("img", { name: "Weight and Calories, last 30 days" })).toBeVisible();
  await second.selectOption("");
  await expect(p.getByRole("img", { name: "Weight, last 30 days" }).locator(".trend-second")).toHaveCount(0);
});

await p.context().close();
await app.close();
c.report();
