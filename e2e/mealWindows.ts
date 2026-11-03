// Meal windows (ticket 07), with a faked clock (Pacific): the add box's Meal picker starts on the
// guess from my Meal windows, a Meal I pick sticks until I reopen the app, a date rollover guesses
// again, and I can edit my windows in Profile (stored per Member).
import { expect } from "playwright/test";
import { launch } from "./app";
import { db } from "./backend";
import { checklist, shot, tab } from "./lib";

const app = await launch();
const c = checklist("mealwindows");

/** Nov 2 2026 is PST (UTC-8). */
const pst = (hhmm: string, day = "02") => `2026-11-${day}T${hhmm}:00-08:00`;
const picker = (p: Awaited<ReturnType<typeof app.open>>) => p.getByRole("form", { name: "Add an Entry" }).getByLabel("Meal");

await c.check("on open, the Meal picker is guessed from the default windows", async () => {
  for (const [time, meal] of [["07:00", "breakfast"], ["10:30", "lunch"], ["14:45", "snack"], ["17:00", "dinner"], ["21:15", "dessert"]]) {
    const p = await app.open("asher", { clock: pst(time) });
    c.watch(p);
    await expect(picker(p), `at ${time}`).toHaveValue(meal);
    await p.context().close();
  }
});

await c.check("a Meal I pick sticks across tabs, logging and time passing, until I reopen the app", async () => {
  const p = await app.open("asher", { clock: pst("12:00") });
  c.watch(p);
  await expect(picker(p)).toHaveValue("lunch");
  await picker(p).selectOption("dessert");
  await tab(p, "Week");
  await tab(p, "Today");
  await expect(picker(p)).toHaveValue("dessert");
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill("Brownie");
  await form.getByLabel("Calories").fill("240");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByRole("heading", { name: "Dessert" })).toBeVisible();
  await expect(picker(p)).toHaveValue("dessert");
  await p.clock.runFor("02:00:00");
  await expect(picker(p)).toHaveValue("dessert");
  // Reopening guesses again (now 14:00+, still Lunch).
  await p.reload();
  await expect(picker(p)).toHaveValue("lunch");
  await p.context().close();
});

await c.check("when the date rolls over, the picker guesses again and my pick is dropped", async () => {
  const p = await app.open("asher", { clock: pst("23:58") });
  c.watch(p);
  await expect(picker(p)).toHaveValue("dessert");
  await picker(p).selectOption("snack");
  await p.clock.runFor("00:05:00");
  await expect(picker(p)).toHaveValue("breakfast");
  await p.context().close();
});

await c.check("I edit my windows in Profile; they sync and drive the guess, for my Member only", async () => {
  const p = await app.open("asher", { clock: pst("12:00") });
  c.watch(p);
  await expect(picker(p)).toHaveValue("lunch");
  await tab(p, "Profile");
  const card = p.getByRole("form", { name: "Meal windows" });
  await expect(card.getByLabel("Breakfast starts")).toHaveValue("00:00");
  await expect(card.getByLabel("Dessert starts")).toHaveValue("20:30");
  // Two Meals at once is refused with a message.
  await card.getByLabel("Lunch starts").fill("17:00");
  await card.getByRole("button", { name: "Save Meal windows" }).click();
  await expect(p.getByRole("alert")).toHaveText("Lunch and Dinner can't start at the same time");
  await card.getByLabel("Lunch starts").fill("12:30");
  await card.getByRole("button", { name: "Save Meal windows" }).click();
  await expect(p.getByRole("status")).toHaveText("Meal windows saved.");
  await shot(p, "mealwindows-profile");
  await expect.poll(() => db.dump().find((r) => r.PK === "MEMBER#asher" && r.SK === "MEAL_WINDOWS")?.lunch).toBe("12:30");
  // Reopen at 12:05: before my Lunch now, so Breakfast.
  await p.clock.setSystemTime(new Date(pst("12:05")));
  await p.reload();
  await expect(picker(p)).toHaveValue("breakfast");
  await tab(p, "Profile");
  await expect(p.getByRole("form", { name: "Meal windows" }).getByLabel("Lunch starts")).toHaveValue("12:30");
  await p.context().close();

  const other = await app.open("aubyn", { clock: pst("12:05") });
  c.watch(other);
  await expect(picker(other)).toHaveValue("lunch");
  await other.context().close();
});

c.report();
await app.close();
