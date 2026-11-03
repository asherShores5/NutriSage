// Ticket 18: Yield ratios and the estimated Prepared weight. An unweighed Recipe shows a Prepared
// weight estimated from its ingredients' Yield ratios (Bedrock suggests one for a Library Food that
// has none); editing a ratio changes the estimate and is saved on the Food for next time; a portion
// logs in g on the estimate; weighing the batch switches it to Weighed.
import { expect, type Page } from "playwright/test";
import { launch } from "./app";
import { bedrock, calls, seedLibrary } from "./backend";
import { OUT, checklist, lastCall } from "./lib";

const app = await launch();
const c = checklist("yieldRatios");

// Per 100 g serving: dry rice 360 cal, beans 90 cal. Neither has a Yield ratio yet.
await seedLibrary([{ name: "Dry rice", servingGrams: 100, calories: 360 }, { name: "Kidney beans", servingGrams: 100, calories: 90 }]);
const reply = (yieldRatio?: number) => bedrock.reply(JSON.stringify({ carbs: 1, protein: 1, fat: 1, fiber: 0, sodium: 1, iron: 0, calories: 100, servingGrams: 100, ...(yieldRatio ? { yieldRatio } : {}) }));
const suggestions = () => calls.filter((x) => x.field === "suggestYieldRatio").length;

const builder = (p: Page) => p.getByRole("dialog", { name: "Recipe builder" });
const row = (p: Page, name: string) => builder(p).getByRole("list", { name: "Ingredients" }).getByRole("group", { name });
const note = (p: Page) => builder(p).locator(".prepared-note");

async function addIngredient(p: Page, text: string, amount: string, unit: string) {
  const b = builder(p);
  const rows = b.getByRole("list", { name: "Ingredients" }).locator(":scope > li");
  const before = await rows.count();
  await b.getByLabel("Ingredient", { exact: true }).fill(text);
  await b.getByLabel("Ingredient", { exact: true }).press("Enter");
  // Wait for the new row (an estimate takes a moment), else the amount lands on the previous one.
  await expect(rows).toHaveCount(before + 1);
  const r = rows.last();
  await r.getByLabel("Unit").selectOption(unit);
  await r.getByLabel("Amount").fill(amount);
}

await c.check("an unweighed Recipe shows an estimate from suggested Yield ratios; editing one changes it and logs in g", async () => {
  const p = await app.open("asher");
  c.watch(p);
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await b.getByLabel("Recipe name").fill("Rice and beans");

  reply(2.5);
  await addIngredient(p, "dry rice", "200", "g");
  await expect(row(p, "Dry rice").getByLabel("Yield ratio")).toHaveValue("2.5");
  reply(); // Bedrock has no ratio for the beans: counted as 1
  await addIngredient(p, "kidney beans", "400", "g");
  await expect.poll(suggestions).toBe(2);
  await expect(row(p, "Kidney beans").getByLabel("Yield ratio")).toHaveValue("");
  await expect(row(p, "Kidney beans")).toContainText("Unknown, counted as 1");

  await expect(note(p)).toHaveText("Estimated 900 g from Yield ratios. Weigh the batch for exact portions."); // 200 x 2.5 + 400
  await expect(b.getByLabel("Prepared weight")).toHaveAttribute("placeholder", "Estimated 900 g");
  await b.screenshot({ path: `${OUT}/recipe-yield-estimate.png` });

  // Editing a ratio changes the estimate and saves it on the Food.
  const rice = row(p, "Dry rice").getByLabel("Yield ratio");
  await rice.fill("3");
  await expect(note(p)).toContainText("Estimated 1000 g");
  await rice.blur();
  await expect.poll(() => (lastCall("putFood")?.args as any)?.input?.yieldRatio).toBe(3);

  // A portion in g on the estimate: 1080 cal x 250 / 1000.
  await b.getByRole("group", { name: "Portion" }).getByLabel("Unit").selectOption("g");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Amount").fill("250");
  await expect(b.getByRole("status", { name: "This portion" })).toContainText("270 cal");
  await b.getByLabel("Save to Recipe Book").uncheck();
  await b.getByRole("button", { name: "Log Recipe" }).click();
  await expect(b).toBeHidden();
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.at(-1)).toMatchObject({ name: "Rice and beans", amount: 250, unit: "g", grams: 250 });
  await p.context().close();
});

await c.check("the edited ratio is reused next time, with no new suggestion; weighing switches to Weighed", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  const asked = suggestions();
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await addIngredient(p, "dry rice", "100", "g");
  await expect(row(p, "Dry rice").getByLabel("Yield ratio")).toHaveValue("3");
  await expect(note(p)).toContainText("Estimated 300 g");
  if (suggestions() !== asked) throw new Error("asked Bedrock for a ratio the Food already has");
  await b.getByLabel("Prepared weight").fill("320");
  await expect(note(p)).toHaveText("Weighed");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Unit").selectOption("g");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Amount").fill("160");
  await expect(b.getByRole("status", { name: "This portion" })).toContainText("180 cal"); // 360 x 160 / 320
  await builder(p).getByRole("button", { name: "Cancel" }).click();
  await p.context().close();
});

c.report();
await app.close();
