// Ticket 14: Favorites and Quick Add. Star Library items from their Entries; Quick Add lists them
// most recently used first; logging a starred item (from Quick Add or the add box) moves it to the
// top. Favorites are per Member, survive a reload, and a Guest's stay on the device.
import { expect } from "playwright/test";
import { launch } from "./app";
import { calls, db } from "./backend";
import { checklist, shot } from "./lib";

// Two Foods in the shared Library (per gram, weighed), so the add box logs them with no estimate.
const food = (id: string, name: string, servingGrams: number, calories: number) => ({
  PK: "HOUSEHOLD", SK: `FOOD#${id}`, id, name, createdBy: "asher", updatedAt: 1,
  nutrition: { carbs: 0.5, protein: 0.1, fat: 0.05, fiber: 0.02, sodium: 1, iron: 0.01, calories: calories / servingGrams },
  units: [{ label: "serving", grams: servingGrams }, { label: "g", grams: 1 }],
});
db.seed(food("food-oats", "Rolled oats", 40, 150), food("food-yogurt", "Greek yogurt", 170, 100));

const app = await launch();
const c = checklist("favorites");
const p = await app.open("asher");
c.watch(p);

const quick = p.getByRole("region", { name: "Quick Add" });
const entries = p.getByRole("region", { name: "Entries" });
const order = () => quick.getByRole("button").allTextContents();

async function logFromAddBox(name: string) {
  const form = p.getByRole("form", { name: "Add an Entry" });
  await form.getByLabel("Food").fill(name);
  await expect(form.getByRole("status")).toContainText(name);
  await form.getByRole("button", { name: "Add Entry" }).click();
}

await c.check("Quick Add starts empty, with a hint to star something", async () => {
  await expect(quick.getByText(/Star an Entry/)).toBeVisible();
});

await c.check("star two items from their Entries: the newer star is first in Quick Add", async () => {
  await logFromAddBox("Rolled oats");
  await logFromAddBox("Greek yogurt");
  await entries.getByRole("button", { name: "Star Rolled oats" }).click();
  await p.waitForTimeout(20); // two stars in the same millisecond would tie
  await entries.getByRole("button", { name: "Star Greek yogurt" }).first().click();
  await expect(entries.getByRole("button", { name: "Unstar Rolled oats" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(order).toEqual(["Greek yogurt", "Rolled oats"]);
  await expect.poll(() => calls.filter((x) => x.field === "putFavorite" && x.member === "asher").length).toBe(2);
  await shot(p, "favorites-01-quick-add");
});

await c.check("log the older one from Quick Add: it is logged and moves to the top", async () => {
  const before = await entries.getByText("Rolled oats").count();
  await quick.getByRole("button", { name: "Add Rolled oats" }).click();
  await expect(entries.getByText("Rolled oats")).toHaveCount(before + 1);
  await expect.poll(order).toEqual(["Rolled oats", "Greek yogurt"]);
});

await c.check("logging a starred item from the add box also moves it to the top", async () => {
  await logFromAddBox("Greek yogurt");
  await expect.poll(order).toEqual(["Greek yogurt", "Rolled oats"]);
});

await c.check("the order is kept on the server: it survives a reload", async () => {
  await expect.poll(() => db.dump().filter((r) => r.PK === "MEMBER#asher" && String(r.SK).startsWith("FAV#")).length).toBe(2);
  await p.waitForTimeout(300); // let the last bump reach the API
  await p.reload();
  await expect.poll(order).toEqual(["Greek yogurt", "Rolled oats"]);
});

await c.check("unstarring removes it from Quick Add", async () => {
  await entries.getByRole("button", { name: "Unstar Rolled oats" }).first().click();
  await expect.poll(order).toEqual(["Greek yogurt"]);
  await expect.poll(() => db.dump().some((r) => r.SK === "FAV#food-oats")).toBe(false);
});

await c.check("Favorites are per Member: aubyn's Quick Add is empty", async () => {
  const q = await app.open("aubyn");
  c.watch(q);
  await expect(q.getByRole("region", { name: "Quick Add" }).getByText(/Star an Entry/)).toBeVisible();
  await q.context().close();
});

await c.check("a Guest stars a demo Entry: Quick Add works with no Member API call", async () => {
  const g = await app.open("guest", { signedOut: true });
  c.watch(g);
  await g.getByRole("button", { name: "Try it as a Guest" }).click();
  const before = calls.length;
  const star = g.getByRole("region", { name: "Entries" }).getByRole("button", { name: /^Star / }).first();
  const label = (await star.getAttribute("aria-label"))!.replace(/^Star /, "");
  await star.click();
  await expect(g.getByRole("region", { name: "Quick Add" }).getByRole("button", { name: `Add ${label}` })).toBeVisible();
  await g.reload();
  await expect(g.getByRole("region", { name: "Quick Add" }).getByRole("button", { name: `Add ${label}` })).toBeVisible();
  if (calls.length !== before) throw new Error("a Guest reached the Member API");
  await g.context().close();
});

c.report();
await app.close();
