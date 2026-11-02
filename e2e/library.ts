// Ticket 12: every estimated Food lands in the shared Library (per gram, with units), and the other
// Member can log it by amount x unit without another Bedrock call. Bedrock is stubbed in backend.ts.
import { expect } from "playwright/test";
import { launch } from "./app";
import { bedrock, calls } from "./backend";
import { OUT, checklist, lastCall } from "./lib";

const app = await launch();
const c = checklist("library");

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182, servingGrams: 122, units: { egg: 61 } };
const estimates = () => calls.filter((x) => x.field === "estimate").length;

await c.check("asher estimates a Food: it is logged and saved to the Library", async () => {
  const p = await app.open("asher");
  c.watch(p);
  bedrock.reply(JSON.stringify(EGGS));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill("2 eggs scrambled");
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("2 eggs scrambled")).toBeVisible();
  const entry = (lastCall("putDay")?.args as any)?.input?.entries?.[0];
  if (!entry?.libraryId) throw new Error("the estimated Entry doesn't point at its Library Food");
  await p.context().close();
});

await c.check("aubyn logs asher's Food by amount x one of its units, with no new estimate", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const before = estimates();
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Meal").selectOption("breakfast");
  await form.getByLabel("Food").fill("2 Eggs Scrambled");
  await expect(form.getByRole("status")).toHaveText("In the Library: logs from 2 eggs scrambled");
  await expect(form.getByLabel("Unit").locator("option")).toHaveText(["serving", "g", "egg"]);
  await form.getByLabel("Unit").selectOption("egg");
  await form.getByLabel("Amount").fill("3");
  await form.screenshot({ path: `${OUT}/library-known-food.png` });
  await form.getByRole("button", { name: "Add Entry" }).click();
  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("2 eggs scrambled")).toBeVisible();
  await expect(entries.getByText("183 g")).toBeVisible();
  // 3 eggs x 61 g x (182 cal / 122 g)
  await expect(p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value')).toHaveText("273 cal");
  if (estimates() !== before) throw new Error("logging a Library Food called Bedrock");
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.[0]).toMatchObject({ amount: 3, unit: "egg", grams: 183 });
  await p.context().close();
});

await c.check("a new name still estimates, and joins the Library for the other Member", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  bedrock.reply(JSON.stringify({ carbs: 27, protein: 0.6, fat: 0.2, fiber: 5.5, sodium: 2, iron: 0.3, calories: 101, servingGrams: 178 }));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill("Pear");
  await expect(form.getByRole("button", { name: "Estimate" })).toBeVisible();
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Pear")).toBeVisible();
  await p.context().close();

  const q = await app.open("asher");
  c.watch(q);
  const f = q.getByRole("form", { name: "Add an Entry" });
  await f.getByLabel("Food").fill("pear");
  await expect(f.getByRole("status")).toHaveText("In the Library: logs from Pear");
  await q.context().close();
});

c.report();
await app.close();
