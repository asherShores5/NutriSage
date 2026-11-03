// Ticket 13: fuzzy search in the add box. Typing shows live matches from the Library (typos and
// partial words), tapping one logs it, Enter logs the best match whose name the text covers
// ("chik brst" -> Chicken breast) and otherwise estimates the text as a new Food ("apple" isn't
// Apple pie). A Guest searches their own device Library. Bedrock is stubbed in backend.ts.
import { expect, type Locator } from "playwright/test";
import { launch } from "./app";
import { bedrock, calls, seedLibrary } from "./backend";
import { OUT, checklist, lastCall } from "./lib";

await seedLibrary([
  { name: "Chicken breast", servingGrams: 120, calories: 198 },
  { name: "Chicken thigh", servingGrams: 110 },
  { name: "Banana", servingGrams: 118, calories: 105 },
  { name: "Apple pie", servingGrams: 125, calories: 300 },
]);
const app = await launch();
const c = checklist("search");

/** The match list (not the Meal/Unit selects' options). */
const hitsIn = (form: Locator) => form.getByRole("listbox", { name: "Library matches" });
const estimates = () => calls.filter((x) => x.field === "estimate").length;
const lastEntry = () => {
  const entries = (lastCall("putDay")?.args as any)?.input?.entries ?? [];
  return entries[entries.length - 1];
};

await c.check("'chik brst' finds Chicken breast; tapping it logs it with no estimate", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  const before = estimates();
  await form.getByLabel("Food").fill("chik brst");
  const matches = form.getByRole("listbox", { name: "Library matches" });
  await expect(matches.getByRole("option").first()).toHaveText(/Chicken breast/);
  await form.screenshot({ path: `${OUT}/search-matches.png` });
  await expect(form.getByRole("button", { name: "Add Entry" })).toBeVisible(); // "chik brst" covers Chicken breast: Enter would log it
  await matches.getByRole("option", { name: /Chicken breast/ }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Chicken breast")).toBeVisible();
  await expect(form.getByLabel("Food")).toHaveValue("");
  await expect(matches).toHaveCount(0);
  if (estimates() !== before) throw new Error("tapping a match called Bedrock");
  await expect.poll(lastEntry).toMatchObject({ name: "Chicken breast", unit: "serving", grams: 120 });
  await p.context().close();
});

await c.check("a typo still finds it, and arrow keys + Enter pick a match", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  const before = estimates();
  await form.getByLabel("Food").fill("bananna");
  await expect(hitsIn(form).getByRole("option").first()).toHaveText(/Banana/);
  await form.getByLabel("Food").press("ArrowDown");
  await expect(form.getByRole("option", { name: /Banana/ })).toHaveAttribute("aria-selected", "true");
  await expect(form.getByRole("status")).toHaveText("In the Library: logs from Banana");
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Banana")).toBeVisible();
  if (estimates() !== before) throw new Error("picking a match called Bedrock");
  await p.context().close();
});

await c.check("nonsense shows no matches, and Enter estimates it as a new Food", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  bedrock.reply(JSON.stringify({ carbs: 3, protein: 1, fat: 0, fiber: 1, sodium: 5, iron: 0, calories: 20, servingGrams: 50 }));
  const before = estimates();
  await form.getByLabel("Food").fill("zxqv plorb");
  await expect(hitsIn(form).getByRole("option")).toHaveCount(0);
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("zxqv plorb")).toBeVisible();
  if (estimates() !== before + 1) throw new Error("Enter with no match didn't estimate");
  await p.context().close();
});

await c.check("Enter on a near-but-not-whole match estimates the typed text, not the match", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  bedrock.reply(JSON.stringify({ carbs: 8, protein: 12, fat: 4, fiber: 1, sodium: 800, iron: 1, calories: 120, servingGrams: 240 }));
  const before = estimates();
  await form.getByLabel("Food").fill("chicken soup");
  await expect(hitsIn(form).getByRole("option").first()).toHaveText(/Chicken/);
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("chicken soup")).toBeVisible();
  if (estimates() !== before + 1) throw new Error("Enter didn't estimate the typed text");
  await p.context().close();
});

await c.check("Enter logs a match the text covers ('chik brst'), but estimates 'apple' instead of picking Apple pie", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  const entries = p.getByRole("region", { name: "Entries" });
  const before = estimates();
  await form.getByLabel("Food").fill("chik brst");
  await expect(form.getByRole("status")).toHaveText("In the Library: logs from Chicken breast");
  await form.getByLabel("Food").press("Enter");
  await expect.poll(lastEntry).toMatchObject({ name: "Chicken breast" }); // the Day holds earlier checks' Entries too
  if (estimates() !== before) throw new Error("Enter on a covered match called Bedrock");
  bedrock.reply(JSON.stringify({ carbs: 25, protein: 0, fat: 0, fiber: 4, sodium: 2, iron: 0, calories: 95, servingGrams: 182 }));
  await form.getByLabel("Food").fill("apple");
  await expect(hitsIn(form).getByRole("option").first()).toHaveText(/Apple pie/);
  await expect(form.getByRole("button", { name: "Estimate" })).toBeVisible();
  await form.getByLabel("Food").press("Enter");
  await expect(entries.getByRole("button", { name: /^apple(?! pie)/ })).toBeVisible();
  await expect.poll(lastEntry).toMatchObject({ name: "apple" });
  if (estimates() !== before + 1) throw new Error("Enter on 'apple' didn't estimate");
  await p.context().close();
});

await c.check("a Guest searches their own device Library", async () => {
  const p = await app.open("guest", { signedOut: true });
  c.watch(p);
  await p.getByRole("button", { name: "Try it as a Guest" }).click();
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill("chikn salad");
  const options = hitsIn(form).getByRole("option");
  await expect(options.first()).toHaveText(/Grilled chicken salad/);
  await expect(form.getByRole("option", { name: /Chicken breast/ })).toHaveCount(0); // the household's, not theirs
  await options.first().click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Grilled chicken salad").first()).toBeVisible();
  await p.context().close();
});

c.report();
await app.close();
