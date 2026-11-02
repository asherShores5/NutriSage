// Ticket 06: move an Entry to another Meal and to another Day from its editor (amount and nutrition
// unchanged, both Days written), delete an Entry; Today's Day navigation (arrows, date pick) and Clear day.
import { expect } from "playwright/test";
import { launch, todayKey } from "./app";
import { calls, db } from "./backend";
import { checklist } from "./lib";

const app = await launch();
const c = checklist("move");
const p = await app.open("asher");
c.watch(p);

const today = todayKey();
const yesterday = todayKey(Date.now() - 86_400_000);
const entries = p.getByRole("region", { name: "Entries" });
const heading = p.locator(".day-nav h2");
const nav = p.getByRole("group", { name: "Day" });
const editor = (name: string) => p.getByRole("group", { name: `Edit ${name}` });
const stored = (date: string) => db.dump().find((r) => r.PK === "MEMBER#asher" && r.SK === `DAY#${date}`) as any;

async function logByHand(food: string, meal: string, calories: string) {
  const form = p.getByRole("form", { name: "Add an Entry" });
  if (await form.getByRole("button", { name: "Type nutrition by hand" }).isVisible()) await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill(food);
  await form.getByLabel("Meal").selectOption(meal);
  await form.getByLabel("Carbs").fill("70");
  await form.getByLabel("Protein").fill("45");
  await form.getByLabel("Calories").fill(calories);
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(entries.getByText(food)).toBeVisible();
}

await c.check("the header shows Today, with arrows to the previous and next Day", async () => {
  await expect(heading).toHaveText("Today");
  await expect(nav.getByRole("button", { name: "Previous Day" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Next Day" })).toBeVisible();
  await expect(nav.getByLabel("Pick a Day")).toHaveValue(today);
  await expect(nav.getByRole("button", { name: "Back to today" })).toHaveCount(0);
});

await c.check("moves an Entry from Lunch to Dinner, keeping its nutrition", async () => {
  await logByHand("Burrito bowl", "lunch", "680");
  await logByHand("Apple", "snack", "95");
  await entries.getByRole("button", { name: /Burrito bowl/ }).click();
  await editor("Burrito bowl").getByLabel("Meal").selectOption("dinner");
  await expect(entries.getByRole("group", { name: "Dinner" }).getByText("Burrito bowl")).toBeVisible();
  await expect(entries.getByRole("group", { name: "Lunch" })).toHaveCount(0);
  await expect.poll(() => stored(today)?.entries?.find((e: any) => e.name === "Burrito bowl")?.meal).toBe("dinner");
  if (stored(today).entries.find((e: any) => e.name === "Burrito bowl").nutrition.calories !== 680) throw new Error("calories changed");
});

await c.check("moves it to yesterday: it leaves Today and both Days are written", async () => {
  const before = calls.length;
  await editor("Burrito bowl").getByLabel("Day").fill(yesterday);
  await expect(entries.getByText("Burrito bowl")).toHaveCount(0);
  await expect(entries.getByText("Apple")).toBeVisible();
  await expect.poll(() => stored(today)?.entries?.length).toBe(1);
  const y = stored(yesterday);
  const moved = y?.entries?.[0];
  if (!moved || moved.name !== "Burrito bowl" || moved.meal !== "dinner" || moved.nutrition.calories !== 680 || moved.nutrition.protein !== 45) {
    throw new Error(`yesterday holds ${JSON.stringify(y)}`);
  }
  const dates = calls.slice(before).filter((x) => x.field === "putDay").map((x) => (x.args as any).input.date);
  if (JSON.stringify(dates) !== JSON.stringify([yesterday, today])) throw new Error(`putDay order ${dates}`);
});

await c.check("the previous-Day arrow shows yesterday with the moved Entry under Dinner", async () => {
  await nav.getByRole("button", { name: "Previous Day" }).click();
  await expect(heading).toHaveText("Yesterday");
  await expect(nav.getByLabel("Pick a Day")).toHaveValue(yesterday);
  await expect(entries.getByRole("group", { name: "Dinner" }).getByText("Burrito bowl")).toBeVisible();
  await expect(entries.getByRole("group", { name: "Dinner" }).getByText("680 cal").first()).toBeVisible();
  await expect(p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value')).toHaveText("680 cal");
});

await c.check("deletes an Entry from its editor", async () => {
  await entries.getByRole("button", { name: /Burrito bowl/ }).click();
  await editor("Burrito bowl").getByRole("button", { name: "Delete" }).click();
  await expect(p.getByText("Nothing logged yet.")).toBeVisible();
  await expect.poll(() => stored(yesterday)?.entries?.length).toBe(0);
});

await c.check("the next-Day arrow, a picked date and Back to today all navigate", async () => {
  await nav.getByRole("button", { name: "Next Day" }).click();
  await expect(heading).toHaveText("Today");
  await expect(entries.getByText("Apple")).toBeVisible();
  await nav.getByLabel("Pick a Day").fill("2026-01-15");
  await expect(heading).toHaveText(/Jan 15/);
  await expect(p.getByText("Nothing logged yet.")).toBeVisible();
  await nav.getByRole("button", { name: "Back to today" }).click();
  await expect(heading).toHaveText("Today");
  await expect(entries.getByText("Apple")).toBeVisible();
});

await c.check("Clear day asks first, then removes every Entry but keeps water", async () => {
  await p.getByRole("region", { name: "Water" }).getByRole("button", { name: "+ Cup" }).click();
  await expect.poll(() => stored(today)?.water).toBe(1);
  p.once("dialog", (d) => d.dismiss());
  await p.getByRole("button", { name: "Clear day" }).click();
  await expect(entries.getByText("Apple")).toBeVisible();
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Clear day" }).click();
  await expect(p.getByText("Nothing logged yet today.")).toBeVisible();
  await expect(p.getByRole("button", { name: "Clear day" })).toHaveCount(0);
  await expect.poll(() => stored(today)?.entries?.length).toBe(0);
  if (stored(today).water !== 1) throw new Error("water changed");
});

c.report();
await app.close();
