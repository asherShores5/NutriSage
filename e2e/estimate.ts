// Ticket 02: type a Food on Today and log Bedrock's estimate (Bedrock is stubbed in backend.ts).
import { expect } from "playwright/test";
import { launch } from "./app";
import { bedrock, graphql } from "./backend";
import { checklist, lastCall } from "./lib";

const app = await launch();
const c = checklist("estimate");

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182, servingGrams: 122 };

await c.check("typing a Food and pressing Enter logs an estimated Entry with its grams", async () => {
  const p = await app.open("asher");
  c.watch(p);
  bedrock.reply(JSON.stringify(EGGS));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Meal").selectOption("breakfast");
  await form.getByLabel("Food").fill("2 eggs scrambled");
  await form.getByLabel("Food").press("Enter");
  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("2 eggs scrambled")).toBeVisible();
  await expect(entries.getByRole("heading", { name: "Breakfast" })).toBeVisible();
  await expect(entries.getByText("122 g")).toBeVisible();
  await expect(p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value')).toHaveText("182 cal");
  await expect(form.getByLabel("Food")).toHaveValue("");
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.[0]?.grams).toBe(122);
  if ((lastCall("estimate")?.args as any)?.text !== "2 eggs scrambled") throw new Error("estimate not called with the typed text");
  await p.context().close();
});

await c.check("a new Food in cups: Bedrock estimates 1 1/2 cup, the Entry reads 1 1/2 cup and the Library Food gets a cup unit", async () => {
  const p = await app.open("asher");
  c.watch(p);
  bedrock.reply(JSON.stringify({ carbs: 67.5, protein: 6, fat: 0.6, fiber: 0.9, sodium: 3, iron: 0.6, calories: 307.5, servingGrams: 237 }));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await expect(form.getByLabel("Unit").locator("option")).toHaveText(["serving", "g", "oz", "cup", "tbsp", "tsp", "slice", "piece"]);
  await form.getByLabel("Food").fill("jasmine rice");
  await form.getByLabel("Unit").selectOption("cup");
  await form.getByLabel("Amount").fill("1 1/2");
  await form.getByRole("button", { name: "Estimate" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("jasmine rice")).toBeVisible();
  const args = lastCall("estimate")?.args as any;
  if (args?.amount !== 1.5 || args?.unit !== "cup") throw new Error(`estimate asked for ${JSON.stringify(args)}`);
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.at(-1)).toMatchObject({ name: "jasmine rice", amount: 1.5, unit: "cup", grams: 237, nutrition: { calories: 307.5 } });
  const lib = await graphql("fake-id.asher", `query { library { foods { name units { label grams } } } }`);
  const rice = lib.data.library.foods.find((f: any) => f.name === "jasmine rice");
  if (!rice?.units.some((u: any) => u.label === "cup" && u.grams === 158)) throw new Error(`Library units ${JSON.stringify(rice?.units)}`);
  await p.context().close();
});

await c.check("a failed estimate shows the message, keeps the text and logs nothing", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  bedrock.fail(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill("Costco hot dog");
  await form.getByRole("button", { name: "Estimate" }).click();
  await expect(p.getByRole("alert")).toContainText("Couldn't estimate that right now");
  await expect(form.getByLabel("Food")).toHaveValue("Costco hot dog");
  await expect(p.getByText("Nothing logged yet today.")).toBeVisible();
  await p.context().close();
});

await c.check("typing nutrition by hand still works", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByText("Type nutrition by hand").click();
  await form.getByLabel("Food").fill("Greek yogurt");
  await form.getByLabel("Protein").fill("17");
  await form.getByLabel("Calories").fill("100");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Greek yogurt")).toBeVisible();
  await p.context().close();
});

c.report();
await app.close();
