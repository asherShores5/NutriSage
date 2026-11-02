// Ticket 05: amounts as decimals or fractions with a unit picker, in the add box and the Entry editor.
// Bedrock is stubbed in backend.ts.
import { expect } from "playwright/test";
import { launch } from "./app";
import { bedrock } from "./backend";
import { checklist, lastCall, shot } from "./lib";

const app = await launch();
const c = checklist("amounts");

// One serving: 182 cal, 122 g.
const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182, servingGrams: 122 };
const calories = (p: import("playwright").Page) => p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value');
const sentEntry = () => (lastCall("putDay")?.args as any)?.input?.entries?.[0];

await c.check("logs 1 1/2 servings, then editing it to 1/3 rescales the totals", async () => {
  const p = await app.open("asher");
  c.watch(p);
  bedrock.reply(JSON.stringify(EGGS));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await expect(form.getByLabel("Amount")).toHaveValue("1");
  await form.getByLabel("Food").fill("2 eggs scrambled");
  await form.getByLabel("Amount").fill("1 1/2");
  await form.getByRole("button", { name: "Estimate" }).click();
  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("2 eggs scrambled")).toBeVisible();
  await expect(calories(p)).toHaveText("273 cal");
  await expect(entries.getByText("1 1/2 serving · 183 g")).toBeVisible(); // the row shows amount + unit, not only grams
  await expect(form.getByLabel("Amount")).toHaveValue("1");
  await expect.poll(() => sentEntry()).toMatchObject({ amount: 1.5, unit: "serving", grams: 183 });

  await entries.getByRole("button", { name: /^2 eggs scrambled/ }).click();
  const editor = p.getByRole("group", { name: "Edit 2 eggs scrambled" });
  await expect(editor.getByLabel("Amount")).toHaveValue("1 1/2");
  await editor.getByLabel("Amount").fill("1/3");
  await expect(calories(p)).toHaveText("61 cal");
  await expect.poll(() => sentEntry()?.amount).toBeCloseTo(1 / 3, 6);
  await shot(p, "amounts-editor");

  await p.reload();
  await expect(calories(p)).toHaveText("61 cal");
  await p.getByRole("region", { name: "Entries" }).getByRole("button", { name: /^2 eggs scrambled/ }).click();
  await expect(p.getByRole("group", { name: "Edit 2 eggs scrambled" }).getByLabel("Amount")).toHaveValue("1/3");
  await p.context().close();
});

await c.check("bad amounts show a message instead of resetting, and log or change nothing", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  const before = bedrock.calls.length;
  await form.getByLabel("Food").fill("Toast");
  await form.getByLabel("Amount").fill("0");
  await form.getByRole("button", { name: "Estimate" }).click();
  await expect(form.getByRole("alert")).toHaveText("Amount must be more than 0");
  await form.getByLabel("Amount").fill("150");
  await form.getByRole("button", { name: "Estimate" }).click();
  await expect(form.getByRole("alert")).toHaveText("Amount must be at most 100");
  await expect(form.getByLabel("Amount")).toHaveValue("150");
  if (bedrock.calls.length !== before) throw new Error("Bedrock was called for a bad amount");

  bedrock.reply(JSON.stringify(EGGS));
  await form.getByRole("group", { name: "Quick picks" }).getByRole("button", { name: "2", exact: true }).click();
  await form.getByRole("button", { name: "Estimate" }).click();
  await expect(calories(p)).toHaveText("364 cal");

  const entries = p.getByRole("region", { name: "Entries" });
  await entries.getByRole("button", { name: /^Toast/ }).click();
  const editor = p.getByRole("group", { name: "Edit Toast" });
  await editor.getByLabel("Amount").fill("1 /");
  await expect(editor.getByRole("alert")).toHaveText("Type an amount like 0.4, 1/3 or 1 1/2");
  await expect(editor.getByLabel("Amount")).toHaveValue("1 /");
  await expect(calories(p)).toHaveText("364 cal");
  await editor.getByRole("group", { name: "Quick picks" }).getByRole("button", { name: "1/4" }).click();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(calories(p)).toHaveText("46 cal");
  await p.context().close();
});

await c.check("switching an Entry to g keeps the food, and the gram amount rescales it", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const entries = p.getByRole("region", { name: "Entries" });
  await entries.getByRole("button", { name: /^Toast/ }).click();
  const editor = p.getByRole("group", { name: "Edit Toast" });
  await editor.getByLabel("Unit").selectOption("g");
  await expect(editor.getByLabel("Amount")).toHaveValue("31");
  await expect(calories(p)).toHaveText("46 cal");
  await editor.getByLabel("Amount").fill("61");
  await expect(calories(p)).toHaveText("91 cal");
  await editor.getByLabel("Unit").selectOption("serving");
  await expect(editor.getByLabel("Amount")).toHaveValue("1/2");
  await expect(calories(p)).toHaveText("91 cal");
  await p.context().close();
});

await c.check("an Entry typed by hand is 1 serving of its numbers and scales by its amount", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await expect(form.getByLabel("Unit")).toHaveValue("serving");
  await form.getByLabel("Food").fill("Rice cake");
  await form.getByLabel("Calories").fill("35");
  await form.getByLabel("Amount").fill("3");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Rice cake")).toBeVisible();
  await expect(calories(p)).toHaveText("166 cal"); // 61 from the first check + 105
  await p.context().close();
});

c.report();
await app.close();
