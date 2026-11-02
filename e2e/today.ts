// Walking skeleton (ticket 01): sign in with a password, log an Entry by hand (estimates: estimate.ts), see it on Today
// with totals; it persists, and only for that Member.
import { expect } from "playwright/test";
import { launch, todayKey } from "./app";
import { PASSWORD, db } from "./backend";
import { checklist, lastCall } from "./lib";

const app = await launch();
const c = checklist("today");

await c.check("signs in with a password and lands on Today", async () => {
  const p = await app.open("asher", { signedOut: true });
  c.watch(p);
  await p.getByLabel("Username").fill("Asher");
  await p.getByLabel("Password").fill("wrong-password");
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.getByRole("alert")).toHaveText("Incorrect username or password.");
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(p.getByText("Nothing logged yet today.")).toBeVisible();
  await p.context().close();
});

await c.check("logs an Entry by hand into a Meal and shows it with totals", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill("Greek yogurt");
  await form.getByLabel("Meal").selectOption("snack");
  await form.getByLabel("Protein").fill("17");
  await form.getByLabel("Carbs").fill("6");
  await form.getByLabel("Calories").fill("100");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Greek yogurt")).toBeVisible();
  await expect(p.getByRole("region", { name: "Entries" }).getByRole("heading", { name: "Snack" })).toBeVisible();

  await form.getByLabel("Food").fill("Banana");
  await form.getByLabel("Meal").selectOption("breakfast");
  await form.getByLabel("Carbs").fill("27");
  await form.getByLabel("Calories").fill("105");
  await form.getByRole("button", { name: "Add Entry" }).click();
  const totals = p.getByRole("region", { name: "Totals" });
  await expect(totals.locator(".total", { hasText: "Calories" }).locator(".total-value")).toHaveText("205");
  await expect(totals.locator(".total", { hasText: "Carbs" }).locator(".total-value")).toHaveText("33");
  // Breakfast is listed before Snack.
  await expect(p.getByRole("region", { name: "Entries" }).getByRole("heading")).toHaveText(["Breakfast", "Snack"]);
  await expect.poll(() => (lastCall("putDay")?.args as any)?.input?.entries?.length).toBe(2);
  await p.context().close();
});

await c.check("a bad nutrient shows a message and logs nothing", async () => {
  const p = await app.open("asher");
  c.watch(p);
  const form = p.getByRole("form", { name: "Add an Entry" });
  await expect(p.getByRole("region", { name: "Entries" })).toBeVisible();
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill("Mystery");
  await form.getByLabel("Fat").fill("-3");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("alert")).toHaveText("Fat must be a number, 0 or more");
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Mystery")).toHaveCount(0);
  await p.context().close();
});

await c.check("the Entries persist after a reload, for my Member only", async () => {
  const mine = await app.open("asher");
  c.watch(mine);
  await expect(mine.getByRole("region", { name: "Entries" }).getByText("Greek yogurt")).toBeVisible();
  const stored = db.dump().map((r) => `${r.PK}/${r.SK}`);
  if (JSON.stringify(stored) !== JSON.stringify([`MEMBER#asher/DAY#${todayKey()}`])) throw new Error(`stored ${stored}`);
  const theirs = await app.open("aubyn");
  c.watch(theirs);
  await expect(theirs.getByText("Nothing logged yet today.")).toBeVisible();
  await mine.context().close();
  await theirs.context().close();
});

await c.check("Profile signs out back to the sign-in screen", async () => {
  const p = await app.open("asher");
  c.watch(p);
  await p.getByRole("button", { name: "Profile" }).click();
  await expect(p.getByText("Signed in as asher")).toBeVisible();
  await p.getByRole("button", { name: "Sign out" }).click();
  await expect(p.getByRole("button", { name: "Sign in" })).toBeVisible();
  await p.context().close();
});

c.report();
await app.close();
