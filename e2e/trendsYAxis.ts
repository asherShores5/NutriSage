// Ticket 22, Trends Y-axis and goal line: fit to data, start at 0, or a manual min and max; a goal
// line at the Member's goal (water uses the water goal; weight has none).
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
const putDay = (date: string, calories: number, water: number, weight: number | null) =>
  gql("mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `e-${date}`, meal: "lunch", name: "Seeded lunch", nutrition: { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories } }], water, weight },
  });

await gql("mutation($input: GoalsInput!) { putGoals(input: $input) { calories } }", {
  input: { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 2200, water: 8 },
});
await putDay(ago(6), 1500, 5, 171.4);
await putDay(ago(4), 1800, 6, null);
await putDay(ago(2), 1700, 4, 170.2);

const app = await launch();
const c = checklist("trends-y");
const p = await app.open("aubyn");
c.watch(p);
await tab(p, "Trends");
const chart = p.getByRole("img", { name: "Calories, last 30 days" });
const scale = p.getByLabel("Y-axis scale");
const goalBox = p.getByRole("checkbox", { name: /Goal line/ });
const labels = () => chart.locator("text.trend-label").allTextContents();

await c.check("calories start at 0 with a goal line at my goal, and the axis stretches to reach it", async () => {
  await expect(scale).toHaveValue("zero");
  await expect(chart.locator('.trend-goal[data-goal="2200"]')).toHaveCount(1);
  await expect(chart.getByText("Goal 2200")).toBeVisible();
  expect(await labels()).toContain("2200"); // max label = goal, above the data's 1800
  await shot(p, "trends-y-zero-goal");
});

await c.check("fit to data zooms to the data and still keeps the goal line on screen", async () => {
  await scale.selectOption("fit");
  const l = await labels();
  expect(l).toContain("1500");
  expect(l).toContain("2200");
  await expect(chart.locator(".trend-goal")).toHaveCount(1);
  await shot(p, "trends-y-fit");
});

await c.check("the goal line can be turned off; fit then zooms to the data alone", async () => {
  await goalBox.uncheck();
  await expect(chart.locator(".trend-goal")).toHaveCount(0);
  expect(await labels()).toContain("1800");
  await goalBox.check();
});

await c.check("manual starts from the current bounds and uses the typed min and max", async () => {
  await scale.selectOption("manual");
  await expect(p.getByLabel("Y-axis min")).toHaveValue("1500");
  await expect(p.getByLabel("Y-axis max")).toHaveValue("2200");
  await p.getByLabel("Y-axis min").fill("1600");
  await p.getByLabel("Y-axis max").fill("2000");
  const l = await labels();
  expect(l).toContain("1600");
  expect(l).toContain("2000");
  await expect(chart.locator(".trend-goal")).toHaveCount(0); // 2200 is outside 1600..2000
  await shot(p, "trends-y-manual");
});

await c.check("a manual min not below the max is ignored with a plain message", async () => {
  await p.getByLabel("Y-axis min").fill("2500");
  await expect(p.getByText(/Min must be below max\. Showing 0 to 2200\./)).toBeVisible();
  await p.getByLabel("Y-axis min").fill("1600");
  await expect(p.getByText(/Min must be below max/)).toHaveCount(0);
});

await c.check("water's goal line is the water goal", async () => {
  await p.getByLabel("Metric").selectOption("water");
  await expect(scale).toHaveValue("zero");
  await expect(p.getByRole("img", { name: "Water, last 30 days" }).locator('.trend-goal[data-goal="8"]')).toHaveCount(1);
});

await c.check("weight has no goal: no goal line or toggle, and it fits to the data", async () => {
  await p.getByLabel("Metric").selectOption("weight");
  await expect(scale).toHaveValue("fit");
  await expect(goalBox).toHaveCount(0);
  await expect(p.getByRole("img", { name: "Weight, last 30 days" }).locator(".trend-goal")).toHaveCount(0);
  await shot(p, "trends-y-weight");
});

await p.context().close();
await app.close();
c.report();
