// Ticket 19: the Recipe Book. Save a Recipe from the builder, find it in the add box's search, star
// it there, log it from Quick Add (1/4 of the batch), use it inside another Recipe (one level deep;
// a Recipe that has one in it is refused), edit it in the Library without changing the Entry already
// logged, and delete it: it leaves Quick Add, the Entry stays.
import { expect, type Page } from "playwright/test";
import { launch } from "./app";
import { calls, db, seedLibrary } from "./backend";
import { OUT, checklist, lastCall, shot, tab } from "./lib";

const app = await launch();
const c = checklist("recipeBook");

// Per 100 g serving: beef 250 cal, beans 90 cal, tortilla 300 cal.
await seedLibrary([
  { name: "Ground beef", servingGrams: 100, calories: 250 },
  { name: "Kidney beans", servingGrams: 100, calories: 90 },
  { name: "Tortilla", servingGrams: 100, calories: 300 },
]);

const builder = (p: Page, name = "Recipe builder") => p.getByRole("dialog", { name });
const quick = (p: Page) => p.getByRole("region", { name: "Quick Add" });
const entries = (p: Page) => p.getByRole("region", { name: "Entries" });
const addBox = (p: Page) => p.getByRole("form", { name: "Add an Entry" });

/** Add a Library match (Food or Recipe) to the open builder, then set its amount and unit. */
async function addIngredient(b: ReturnType<typeof builder>, text: string, amount: string, unit: string) {
  await b.getByLabel("Ingredient", { exact: true }).fill(text);
  await b.getByLabel("Ingredient", { exact: true }).press("Enter");
  const row = b.getByRole("list", { name: "Ingredients" }).locator(":scope > li").last();
  await expect(row).toContainText(new RegExp(text, "i"));
  await row.getByLabel("Unit").selectOption(unit);
  await row.getByLabel("Amount").fill(amount);
}

const p = await app.open("asher");
c.watch(p);

await c.check("save Chili to the Recipe Book from the builder", async () => {
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await b.getByLabel("Recipe name").fill("Chili");
  await addIngredient(b, "ground beef", "500", "g");
  await addIngredient(b, "kidney beans", "400", "g");
  await b.getByLabel("Prepared weight").fill("1200"); // 1250 + 360 = 1610 cal in 1200 g
  await b.getByRole("group", { name: "Portion" }).getByLabel("Unit").selectOption("g");
  await b.getByRole("group", { name: "Portion" }).getByLabel("Amount").fill("300");
  await b.getByRole("button", { name: "Log Recipe" }).click();
  await expect(b).toBeHidden();
  await expect(entries(p).getByRole("button", { name: /^Chili/ })).toContainText("403 cal"); // 1610 x 300 / 1200
});

await c.check("the saved Recipe shows in the add box's search, marked Recipe, and is starred from there", async () => {
  await addBox(p).getByLabel("Food").fill("chil");
  const hits = addBox(p).getByRole("listbox", { name: "Library matches" });
  const hit = hits.getByRole("option", { name: /Chili/ });
  await expect(hit).toContainText("Recipe");
  await hit.getByRole("button", { name: "Star Chili" }).click();
  await expect(hit.getByRole("button", { name: "Unstar Chili" })).toHaveAttribute("aria-pressed", "true");
  await expect(hits).toBeVisible(); // starring didn't log the match
  await shot(p, "recipeBook-01-search-star");
  await addBox(p).getByLabel("Food").fill("");
  await expect.poll(() => calls.filter((x) => x.field === "putFavorite" && (x.args as any)?.input?.libraryId === (lastCall("addRecipe")?.args as any)?.id).length).toBe(1);
});

await c.check("Quick Add logs the starred Recipe as 1/4 of the batch", async () => {
  await expect(quick(p)).toContainText("Recipes 1/4 batch");
  const before = await entries(p).getByRole("button", { name: /^Chili/ }).count();
  await quick(p).getByRole("button", { name: "Add Chili" }).click();
  await expect(entries(p).getByRole("button", { name: /^Chili/ })).toHaveCount(before + 1);
  await expect(entries(p).getByRole("button", { name: /^Chili/ }).last()).toContainText("403 cal"); // 1610 / 4
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.at(-1)).toMatchObject({ name: "Chili", amount: 0.25, unit: "batch", grams: 300 });
});

await c.check("a typed whole Recipe name offers batch and g, starting at 1/4 batch", async () => {
  await addBox(p).getByLabel("Food").fill("Chili");
  await expect(addBox(p).getByRole("status")).toContainText("logs from Chili");
  await expect(addBox(p).getByLabel("Amount")).toHaveValue("1/4");
  const units = await addBox(p).getByLabel("Unit").locator("option").allTextContents();
  if (units.join() !== "batch,g") throw new Error(`units: ${units}`);
  await addBox(p).getByLabel("Food").fill("");
});

await c.check("use Chili inside a Burrito (one level deep); the Burrito can't go inside another Recipe", async () => {
  await p.getByRole("button", { name: "Build a Recipe" }).click();
  const b = builder(p);
  await b.getByLabel("Recipe name").fill("Burrito");
  await addIngredient(b, "tortilla", "1", "serving");
  await addIngredient(b, "chili", "300", "g");
  const chiliRow = b.getByRole("group", { name: "Chili" });
  await expect(chiliRow).toContainText("Recipe");
  await expect(chiliRow).toContainText("403 cal");
  await expect(b.getByRole("status", { name: "Recipe total" })).toContainText("703 cal"); // 300 + 402.5
  await b.screenshot({ path: `${OUT}/recipeBook-02-nested.png` });
  await b.getByRole("button", { name: "Log Recipe" }).click();
  await expect(b).toBeHidden();
  const saved = lastCall("addRecipe")?.args as any;
  if (saved?.input?.ingredients?.[1]?.ingredients?.length !== 2) throw new Error(`no nested breakdown: ${JSON.stringify(saved?.input?.ingredients?.[1])}`);

  await p.getByRole("button", { name: "Build a Recipe" }).click();
  await b.getByLabel("Ingredient", { exact: true }).fill("burrito");
  await b.getByLabel("Ingredient", { exact: true }).press("Enter");
  await expect(b.getByRole("alert")).toContainText("Burrito already has a Recipe in it");
  await expect(b.getByRole("list", { name: "Ingredients" })).toHaveCount(0);
  await b.getByRole("button", { name: "Cancel" }).click();
});

await c.check("edit Chili in the Library: ingredients and Prepared weight change, the logged Entries don't", async () => {
  const before = JSON.stringify((lastCall("putDay")?.args as any)?.input?.entries);
  await tab(p, "Profile");
  await p.getByRole("button", { name: "Open Library" }).click();
  const book = p.getByRole("list", { name: "Recipe Book" });
  await expect(book.getByRole("button", { name: /^Burrito/ })).toBeVisible();
  await expect(book.getByRole("button", { name: "Unstar Chili" })).toBeVisible();
  await shot(p, "recipeBook-03-library");
  await book.getByRole("button", { name: /^Chili/ }).click();
  const e = builder(p, "Edit Chili");
  await expect(e.getByLabel("Prepared weight")).toHaveValue("1200");
  await expect(e.getByRole("group", { name: "Portion" })).toHaveCount(0);
  await e.getByRole("group", { name: "Kidney beans" }).getByLabel("Amount").fill("800");
  await e.getByLabel("Prepared weight").fill("1500");
  await expect(e.getByRole("status", { name: "Recipe total" })).toContainText("1970 cal"); // 1250 + 720
  await e.screenshot({ path: `${OUT}/recipeBook-04-edit.png` });
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(e).toBeHidden();
  const put = lastCall("putRecipe")?.args as any;
  if (put?.input?.preparedGrams !== 1500 || put.input.ingredients[1].grams !== 800) throw new Error(`bad edit: ${JSON.stringify(put)}`);
  await expect(book.getByRole("button", { name: /^Chili/ })).toContainText("1970 cal · 1500 g batch");

  await tab(p, "Today");
  await expect(entries(p).getByRole("button", { name: /^Chili/ }).first()).toContainText("403 cal");
  if (JSON.stringify((lastCall("putDay")?.args as any)?.input?.entries) !== before) throw new Error("editing the Recipe rewrote the Day");
});

await c.check("delete Chili: it leaves Quick Add and the Recipe Book; Entries and the Burrito keep their snapshots", async () => {
  await tab(p, "Profile");
  await p.getByRole("button", { name: "Open Library" }).click();
  await p.getByRole("list", { name: "Recipe Book" }).getByRole("button", { name: /^Chili/ }).click();
  p.once("dialog", (d) => void d.accept());
  await builder(p, "Edit Chili").getByRole("button", { name: "Delete" }).click();
  await expect(p.getByRole("list", { name: "Recipe Book" }).getByRole("button", { name: /^Chili/ })).toHaveCount(0);
  await tab(p, "Today");
  await expect(quick(p).getByRole("button", { name: "Add Chili" })).toHaveCount(0);
  await expect(entries(p).getByRole("button", { name: /^Chili/ }).first()).toBeVisible();
  if (db.dump().some((r) => String(r.SK).startsWith("FAV#") && !db.dump().some((x) => x.SK === `RECIPE#${String(r.SK).slice(4)}` || x.SK === `FOOD#${String(r.SK).slice(4)}`))) {
    throw new Error("a Favorite of the deleted Recipe was left on the server");
  }
  const burrito = db.dump().find((r) => r.name === "Burrito") as any;
  if (burrito?.ingredients?.[1]?.name !== "Chili") throw new Error("the Burrito lost its Chili");
});

await p.context().close();

await c.check("desktop and dark: the Library with its Recipe Book", async () => {
  const q = await app.open("aubyn", { device: "desktop", dark: true });
  c.watch(q);
  await tab(q, "Profile");
  await q.getByRole("button", { name: "Open Library" }).click();
  await expect(q.getByRole("list", { name: "Recipe Book" }).getByRole("button", { name: /^Burrito/ })).toBeVisible();
  await shot(q, "recipeBook-05-library-desktop-dark");
  await q.context().close();
});

c.report();
await app.close();
