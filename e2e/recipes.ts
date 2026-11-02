// Ticket 17: the Recipe builder. Build a 3-ingredient Recipe (two Library Foods, one new Bedrock
// estimate), see live totals, enter the Prepared weight, log 350 g as one Entry and expand it to see
// the breakdown; it's saved to the Recipe Book. Then a fraction of the batch, without saving.
import { expect, type Page } from "playwright/test";
import { launch } from "./app";
import { bedrock, calls, seedLibrary } from "./backend";
import { OUT, checklist, lastCall } from "./lib";

const app = await launch();
const c = checklist("recipes");

// Per 100 g serving: beef 250 cal, beans 90 cal.
await seedLibrary([{ name: "Ground beef", servingGrams: 100, calories: 250 }, { name: "Kidney beans", servingGrams: 100, calories: 90 }]);
const TOMATOES = { carbs: 9.6, protein: 2.4, fat: 0.5, fiber: 2.4, sodium: 30, iron: 1, calories: 48, servingGrams: 240, yieldRatio: 1 };

const builder = (p: Page) => p.getByRole("dialog", { name: "Recipe builder" });

/** Add a Library Food or estimate a new one, then set its amount and unit. */
async function addIngredient(p: Page, text: string, amount: string, unit: string) {
  const b = builder(p);
  const rows = b.getByRole("list", { name: "Ingredients" }).locator(":scope > li");
  const before = await rows.count();
  await b.getByLabel("Ingredient", { exact: true }).fill(text);
  await b.getByLabel("Ingredient", { exact: true }).press("Enter");
  // Wait for the new row (an estimate takes a moment), else the amount lands on the previous one.
  await expect(rows).toHaveCount(before + 1);
  const row = rows.last();
  await row.getByLabel("Unit").selectOption(unit);
  await row.getByLabel("Amount").fill(amount);
}

await c.check("build a 3-ingredient Recipe with live totals, log 350 g, and expand the Entry", async () => {
  const p = await app.open("asher");
  c.watch(p);
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await expect(b).toBeVisible();
  await b.getByLabel("Recipe name").fill("Chili");

  await addIngredient(p, "ground beef", "500", "g");
  await expect(b.getByRole("status", { name: "Recipe total" })).toContainText("1250 cal");
  await addIngredient(p, "kidney beans", "400", "g");
  bedrock.reply(JSON.stringify(TOMATOES));
  await addIngredient(p, "Crushed tomatoes", "2", "serving");
  const est = lastCall("estimate")?.args as { text: string; ingredient?: boolean };
  if (est?.text !== "Crushed tomatoes" || est.ingredient !== true) throw new Error(`the new ingredient wasn't estimated as an ingredient: ${JSON.stringify(est)}`);

  const total = b.getByRole("status", { name: "Recipe total" });
  await expect(total).toContainText("1706 cal"); // 1250 + 360 + 96
  await expect(total).toContainText("Raw weight 1380 g");

  // Unweighed, the Prepared weight is estimated from Yield ratios (ticket 18; none known here, so x1).
  await expect(b.locator(".prepared-note")).toContainText("Estimated 1380 g");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Unit").selectOption("g");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Amount").fill("350");

  await b.getByLabel("Prepared weight").fill("1200");
  await expect(b.locator(".prepared-note")).toHaveText("Weighed");
  await expect(b.getByRole("status", { name: "This portion" })).toContainText("498 cal"); // 1706 x 350 / 1200
  await expect(b.getByLabel("Save to Recipe Book")).toBeChecked();
  await b.screenshot({ path: `${OUT}/recipe-builder.png` });
  await b.getByRole("button", { name: "Log Recipe" }).click();
  await expect(b).toBeHidden();

  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("Chili")).toBeVisible();
  await expect(entries.getByText("350 g")).toBeVisible();
  await expect(p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value')).toHaveText("498 cal");

  const saved = lastCall("addRecipe")?.args as any;
  if (saved?.input?.name !== "Chili" || saved.input.ingredients.length !== 3 || saved.input.preparedGrams !== 1200) throw new Error(`Recipe not saved: ${JSON.stringify(saved)}`);
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.[0]).toMatchObject({ name: "Chili", amount: 350, unit: "g", grams: 350, libraryId: saved.id });

  await entries.getByRole("button", { name: /^Chili/ }).click();
  const breakdown = entries.getByRole("region", { name: "Ingredients of Chili" });
  await expect(breakdown.getByRole("listitem")).toHaveCount(3);
  await expect(breakdown.getByRole("listitem").nth(0)).toContainText("Ground beef");
  await expect(breakdown.getByRole("listitem").nth(0)).toContainText("146 g"); // 500 x 350 / 1200
  await expect(breakdown.getByRole("listitem").nth(2)).toContainText("Crushed tomatoes");
  await expect(breakdown.getByRole("listitem").nth(2)).toContainText("140 g");
  await p.locator(".today").screenshot({ path: `${OUT}/recipe-entry-expanded.png` });

  // The breakdown survives a reload (it's part of the Day).
  await p.reload();
  await p.getByRole("region", { name: "Entries" }).getByRole("button", { name: /^Chili/ }).click();
  await expect(p.getByRole("region", { name: "Ingredients of Chili" }).getByRole("listitem")).toHaveCount(3);
  await p.context().close();
});

await c.check("log a fraction of the unweighed batch, without saving", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const saves = calls.filter((x) => x.field === "addRecipe").length;
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await b.getByLabel("Recipe name").fill("Bean bowl");
  await addIngredient(p, "kidney beans", "400", "g");
  await b.getByRole("group", { name: "Portion" }).getByRole("button", { name: "1/4" }).click();
  await expect(b.getByRole("status", { name: "This portion" })).toContainText("90 cal");
  await b.getByLabel("Save to Recipe Book").uncheck();
  await b.getByRole("button", { name: "Log Recipe" }).click();
  await expect(b).toBeHidden();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Bean bowl")).toBeVisible();
  if (calls.filter((x) => x.field === "addRecipe").length !== saves) throw new Error("an unsaved Recipe was saved");
  const entry = (lastCall("putDay")?.args as any)?.input?.entries?.[0];
  // 1/4 of the 400 g estimate (beans have no Yield ratio: x1).
  if (entry?.unit !== "batch" || entry.amount !== 0.25 || entry.libraryId || entry.grams !== 100) throw new Error(`bad Entry: ${JSON.stringify(entry)}`);
  await p.context().close();
});

await c.check("Cancel closes the builder without logging", async () => {
  const p = await app.open("aubyn", { device: "desktop", dark: true });
  c.watch(p);
  const puts = calls.filter((x) => x.field === "putDay").length;
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  await addIngredient(p, "ground beef", "1", "serving");
  await builder(p).screenshot({ path: `${OUT}/recipe-builder-desktop-dark.png` });
  await builder(p).getByRole("button", { name: "Cancel" }).click();
  await expect(builder(p)).toBeHidden();
  if (calls.filter((x) => x.field === "putDay").length !== puts) throw new Error("Cancel logged something");
  await p.context().close();
});

c.report();
await app.close();
