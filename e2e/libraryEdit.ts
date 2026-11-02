// Ticket 15: the Library screen, opened from Profile. aubyn edits asher's Food (name, nutrition per
// serving, a unit, Yield ratio), then deletes it: it leaves the Library and both Members' Favorites,
// and asher's Entry logged from it keeps its snapshot. A Guest edits their device Library.
import { expect } from "playwright/test";
import { launch, type Page } from "./app";
import { bedrock, calls, db } from "./backend";
import { checklist, lastCall, shot, tab } from "./lib";

const app = await launch();
const c = checklist("library-edit");

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182, servingGrams: 122, units: { egg: 61 } };

async function openLibrary(p: Page) {
  await tab(p, "Profile");
  await p.getByRole("button", { name: "Open Library" }).click();
  await expect(p.getByRole("heading", { name: "Library" })).toBeVisible();
}
const caloriesBar = (p: Page) => p.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value');
let foodId = "";

await c.check("asher's estimate is logged and joins the Library", async () => {
  const p = await app.open("asher");
  c.watch(p);
  bedrock.reply(JSON.stringify(EGGS));
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill("2 eggs scrambled");
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("2 eggs scrambled")).toBeVisible();
  await expect(caloriesBar(p)).toHaveText("182 cal");
  foodId = (lastCall("putDay")?.args as any)?.input?.entries?.[0]?.libraryId;
  if (!foodId) throw new Error("no Library Food on the Entry");
  await p.context().close();
});

await c.check("aubyn edits it from Profile > Library: name, nutrition per serving, a unit and Yield ratio", async () => {
  const p = await app.open("aubyn");
  c.watch(p);
  await openLibrary(p);
  const list = p.getByRole("list", { name: "Foods" });
  await expect(list.getByText("182 cal · 122 g serving")).toBeVisible();
  await shot(p, "library-edit-01-list");
  await list.getByRole("button", { name: /^2 eggs scrambled/ }).click();
  const form = p.getByRole("form", { name: "Edit 2 eggs scrambled" });
  await expect(form.getByLabel("Calories")).toHaveValue("182");
  await expect(form.getByLabel("Unit name")).toHaveValue("egg");
  await form.getByLabel("Name", { exact: true }).fill("Scrambled eggs");
  await form.getByLabel("Calories").fill("200");
  await form.getByLabel("Serving weight").fill("100");
  await form.getByRole("button", { name: "+ Add a unit" }).click();
  await form.getByRole("group", { name: "Unit 2" }).getByLabel("Unit name").fill("Plate");
  await form.getByRole("group", { name: "Unit 2" }).getByLabel("Unit grams").fill("250");
  await form.getByLabel("Yield ratio").fill("abc");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveText("Yield ratio must be a number");
  await form.getByLabel("Yield ratio").fill("0.9");
  await shot(p, "library-edit-02-editor");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Scrambled eggs")).toBeVisible();
  await expect(list.getByText("200 cal · 100 g serving")).toBeVisible();
  const args = lastCall("putFood")?.args as any;
  expect(args).toMatchObject({ id: foodId, input: { name: "Scrambled eggs", servingGrams: 100, yieldRatio: 0.9, units: [{ label: "egg", grams: 61 }, { label: "Plate", grams: 250 }] } });

  // Logging it now uses the edit: 1 plate = 250 g x 2 cal/g.
  await tab(p, "Today");
  const add = p.getByRole("form", { name: "Add an Entry" });
  await add.getByLabel("Food").fill("scrambled eggs");
  await expect(add.getByRole("status")).toHaveText("In the Library: logs from Scrambled eggs");
  await expect(add.getByLabel("Unit").locator("option")).toHaveText(["serving", "g", "egg", "plate"]);
  await p.context().close();
});

await c.check("asher's Entry logged before the edit keeps its snapshot", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("2 eggs scrambled")).toBeVisible();
  await expect(caloriesBar(p)).toHaveText("182 cal");
  await p.context().close();
});

await c.check("aubyn deletes it: gone from the Library and both Members' Favorites; asher's Entry stays", async () => {
  // Favorites as ticket 14 stores them, seeded directly.
  db.seed({ PK: "MEMBER#asher", SK: `FAV#${foodId}`, libraryId: foodId, lastUsed: 1 }, { PK: "MEMBER#aubyn", SK: `FAV#${foodId}`, libraryId: foodId, lastUsed: 2 });
  const p = await app.open("aubyn");
  c.watch(p);
  await openLibrary(p);
  await p.getByRole("list", { name: "Foods" }).getByRole("button", { name: /^Scrambled eggs/ }).click();
  p.once("dialog", (d) => void d.accept());
  await p.getByRole("form", { name: "Edit Scrambled eggs" }).getByRole("button", { name: "Delete" }).click();
  await expect(p.getByText("The Library is empty. Foods join it when you estimate them.")).toBeVisible();
  expect(lastCall("deleteFood")?.args).toEqual({ id: foodId });
  const favs = db.dump().filter((r) => String(r.SK).startsWith("FAV#"));
  if (favs.length) throw new Error(`Favorites left behind: ${favs.map((r) => r.PK).join(", ")}`);
  await p.context().close();

  const q = await app.open("asher");
  c.watch(q);
  await expect(q.getByRole("region", { name: "Entries" }).getByText("2 eggs scrambled")).toBeVisible();
  await expect(caloriesBar(q)).toHaveText("182 cal");
  const add = q.getByRole("form", { name: "Add an Entry" });
  await add.getByLabel("Food").fill("scrambled eggs");
  await expect(add.getByRole("button", { name: "Estimate" })).toBeVisible();
  await q.context().close();
});

await c.check("a Guest edits and deletes Foods in their device Library, with no Member API call", async () => {
  const before = calls.length;
  const p = await app.open("guest", { signedOut: true });
  c.watch(p);
  await p.getByRole("button", { name: "Try it as a Guest" }).click();
  await openLibrary(p);
  const list = p.getByRole("list", { name: "Foods" });
  await list.getByRole("button", { name: /^Apple/ }).click();
  const form = p.getByRole("form", { name: "Edit Apple" });
  await form.getByLabel("Name", { exact: true }).fill("Green apple");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Green apple")).toBeVisible();
  await list.getByRole("button", { name: /^Green apple/ }).click();
  p.once("dialog", (d) => void d.accept());
  await p.getByRole("form", { name: "Edit Green apple" }).getByRole("button", { name: "Delete" }).click();
  await expect(list.getByText("Green apple")).toHaveCount(0);
  await p.reload();
  await openLibrary(p);
  await expect(p.getByRole("list", { name: "Foods" }).getByRole("listitem")).toHaveCount(7);
  if (calls.length !== before) throw new Error("a Guest reached the Member API");
  await p.context().close();
});

await c.check("screenshots: Library on desktop and in dark mode", async () => {
  for (const opts of [{ device: "desktop" as const }, { dark: true }]) {
    const p = await app.open("guest", { signedOut: true, ...opts });
    c.watch(p);
    await p.getByRole("button", { name: "Try it as a Guest" }).click();
    await openLibrary(p);
    await shot(p, `library-edit-03-${opts.dark ? "dark" : "desktop"}-list`);
    await p.getByRole("list", { name: "Foods" }).getByRole("button").first().click();
    await shot(p, `library-edit-04-${opts.dark ? "dark" : "desktop"}-editor`);
    await p.context().close();
  }
});

c.report();
await app.close();
