// Ticket 04, Today parity: Goals set every target; one Entry in each Meal (incl. Dessert) groups in
// order and drives the bars (carb/fat shared energy pool); water cups and weight save with the Day;
// Entries delete from the editor; Profile switches theme.
import { expect } from "playwright/test";
import { launch } from "./app";
import { checklist, lastCall, tab } from "./lib";

const app = await launch();
const c = checklist("parity");
const p = await app.open("asher");
c.watch(p);

const lastDay = () => (lastCall("putDay")?.args as any)?.input;
const bars = p.getByRole("region", { name: "Progress" });
const bar = (key: string) => bars.locator(`[data-nutrient="${key}"]`);
const entries = p.getByRole("region", { name: "Entries" });
const MEALS = ["Breakfast", "Lunch", "Dinner", "Dessert", "Snack"];

await c.check("the Goals tab sets a target for every nutrient and water", async () => {
  await tab(p, "Goals");
  const form = p.getByRole("form", { name: "Goals" });
  for (const [label, v] of Object.entries({ Carbs: "200", Protein: "100", Fat: "60", Fiber: "30", Calories: "2000", Sodium: "2000", Iron: "10", Water: "6" })) {
    await form.getByLabel(`${label} goal`).fill(v);
  }
  await form.getByLabel("Water goal").fill("6.5");
  await form.getByRole("button", { name: "Save goals" }).click();
  await expect(form.getByRole("alert")).toHaveText("Water goal must be a whole number of cups");
  await form.getByLabel("Water goal").fill("6");
  await form.getByRole("button", { name: "Save goals" }).click();
  await expect(form.getByRole("status")).toHaveText("Goals saved.");
  const sent = (lastCall("putGoals")?.args as any)?.input;
  if (JSON.stringify(sent) !== JSON.stringify({ carbs: 200, protein: 100, fat: 60, fiber: 30, sodium: 2000, iron: 10, calories: 2000, water: 6 })) {
    throw new Error(`putGoals sent ${JSON.stringify(sent)}`);
  }
});

await c.check("one Entry in each Meal, Dessert included, groups in display order with Meal calories", async () => {
  await tab(p, "Today");
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  // Each: 31 g carbs, 10 g protein, 16 g fat, 2 g fiber, 500 mg sodium, 1 mg iron, 300 cal.
  for (const meal of [...MEALS].reverse()) {
    await form.getByLabel("Food").fill(`${meal} food`);
    await form.getByLabel("Meal").selectOption(meal.toLowerCase());
    for (const [label, v] of Object.entries({ Carbs: "31", Protein: "10", Fat: "16", Fiber: "2", Sodium: "500", Iron: "1", Calories: "300" })) {
      await form.getByLabel(label).fill(v);
    }
    await form.getByRole("button", { name: "Add Entry" }).click();
    await expect(entries.getByText(`${meal} food`)).toBeVisible();
  }
  await expect(entries.getByRole("heading")).toHaveText(MEALS);
  await expect(entries.getByRole("group", { name: "Dessert" }).locator(".meal-cal")).toHaveText("300 cal");
});

await c.check("the bars split Macros from Micronutrients and color carbs/fat as one energy pool", async () => {
  // Totals: carbs 155/200, fat 80/60 -> pool 1340 cal on target, so fat "spills" 180 cal into carbs.
  await expect(bar("fat")).toHaveAttribute("data-state", "spill");
  await expect(bar("fat").locator(".bar-note")).toHaveText("⇄ 180 cal swapped with carbs");
  await expect(bar("carbs")).toHaveAttribute("data-state", "good");
  await expect(bar("sodium")).toHaveAttribute("data-state", "over");
  await expect(bar("protein")).not.toHaveAttribute("data-state");
  await expect(bar("calories").locator(".bar-value")).toHaveText("1500 / 2000 cal");
  await expect(bars.getByRole("progressbar", { name: "Protein" })).toHaveAttribute("aria-valuenow", "50");
  await expect(bars.locator(".bar-group-label")).toHaveText(["Micronutrients"]);
  const order = await bars.locator(".bar").evaluateAll((els) => els.map((e) => e.getAttribute("data-nutrient")));
  if (order.join() !== "carbs,protein,fat,fiber,calories,sodium,iron") throw new Error(`bar order ${order}`);
});

await c.check("water cups count against the water goal and save with the Day", async () => {
  const water = p.getByRole("region", { name: "Water" });
  const cups = water.locator(".cup");
  await expect(water.locator(".water-count")).toHaveText("0 / 6 cups");
  await expect(cups).toHaveCount(6);
  await cups.nth(2).click();
  await expect(water.locator(".water-count")).toHaveText("3 / 6 cups");
  await cups.nth(2).click(); // tapping the top filled cup takes one off
  await expect(water.locator(".water-count")).toHaveText("2 / 6 cups");
  for (let i = 0; i < 5; i++) await water.getByRole("button", { name: "+ Cup" }).click();
  await expect(water.locator(".water-count")).toHaveText("7 / 6 cups");
  await expect(cups).toHaveCount(7);
  await water.getByRole("button", { name: "Remove a cup" }).click();
  await expect.poll(() => lastDay()?.water).toBe(6);
  if (lastDay().entries.length !== 5) throw new Error("the water write dropped the Entries");
});

await c.check("weight is once per Day, refuses junk, saves with Entries and water, and clears", async () => {
  const weight = p.getByRole("region", { name: "Weight" });
  await expect(weight.locator(".weight-current")).toHaveText("Not logged");
  await expect(weight.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await weight.getByLabel("Today's weight").fill("0");
  await weight.getByRole("button", { name: "Save" }).click();
  await expect(weight.getByRole("alert")).toHaveText("Weight must be a number from 0.1 to 2000");
  await weight.getByLabel("Today's weight").fill("171.4");
  await weight.getByRole("button", { name: "Save" }).click();
  await expect(weight.locator(".weight-current")).toHaveText("171.4");
  await expect.poll(() => lastDay()?.weight).toBe(171.4);
  if (lastDay().water !== 6 || lastDay().entries.length !== 5) throw new Error(`weight write lost data: ${JSON.stringify(lastDay())}`);
  await weight.getByRole("button", { name: "Clear" }).click();
  await expect(weight.locator(".weight-current")).toHaveText("Not logged");
  await expect.poll(() => lastDay()?.weight).toBeNull();
  await weight.getByLabel("Today's weight").fill("170");
  await weight.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => lastDay()?.weight).toBe(170);
});

await c.check("an Entry deletes from its editor and the bars follow", async () => {
  await entries.getByRole("button", { name: /Dessert food/ }).click();
  await entries.getByRole("group", { name: "Edit Dessert food" }).getByRole("button", { name: "Delete" }).click();
  await expect(entries.getByText("Dessert food")).toHaveCount(0);
  await expect(entries.getByRole("heading")).toHaveText(["Breakfast", "Lunch", "Dinner", "Snack"]);
  await expect(bar("calories").locator(".bar-value")).toHaveText("1200 / 2000 cal");
  await expect.poll(() => lastDay()?.entries.length).toBe(4);
});

await c.check("after a reload the Day (Entries, water, weight) and goals are still there", async () => {
  await p.reload();
  await expect(entries.getByRole("heading")).toHaveText(["Breakfast", "Lunch", "Dinner", "Snack"]);
  await expect(p.getByRole("region", { name: "Water" }).locator(".water-count")).toHaveText("6 / 6 cups");
  await expect(p.getByRole("region", { name: "Weight" }).locator(".weight-current")).toHaveText("170");
  await expect(bar("calories").locator(".bar-value")).toHaveText("1200 / 2000 cal");
});

await c.check("Profile switches theme between light, dark and system, and it sticks across a reload", async () => {
  await tab(p, "Profile");
  await p.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await p.reload();
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await tab(p, "Profile");
  await expect(p.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
  await p.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
  await p.getByRole("combobox", { name: "Theme" }).selectOption("system");
  await expect(p.locator("html")).not.toHaveAttribute("data-theme");
});

await c.check("another Member sees none of it", async () => {
  const q = await app.open("aubyn");
  c.watch(q);
  await expect(q.getByText("Nothing logged yet today.")).toBeVisible();
  await expect(q.getByRole("region", { name: "Water" }).locator(".water-count")).toHaveText("0 / 8 cups");
  await expect(q.getByRole("region", { name: "Progress" }).locator('[data-nutrient="calories"] .bar-value')).toHaveText("0 cal");
  await q.context().close();
});

c.report();
await app.close();
