// Offline logging and sync (ticket 09): an Entry logged offline waits on the device and reaches
// the backend once the app is back online, also across a reload; the service worker opens the app
// offline; a change on one device shows on another when that one comes back to the front.
import { expect } from "playwright/test";
import { launch, setOffline, todayKey, type Page } from "./app";
import { db, graphql } from "./backend";
import { checklist } from "./lib";

const app = await launch();
const c = checklist("offline");

/** Entry names on the backend's copy of a Member's Day. */
async function backendEntries(user: string, date = todayKey()): Promise<string[]> {
  const r = await graphql(`fake-id.${user}`, `query($d: String!) { days(from: $d, to: $d) { entries { name } } }`, { d: date });
  return (r.data?.days?.[0]?.entries ?? []).map((e: { name: string }) => e.name);
}

async function logByHand(p: Page, food: string, calories: string) {
  const form = p.getByRole("form", { name: "Add an Entry" });
  const byHand = form.getByRole("button", { name: "Type nutrition by hand" });
  if (await byHand.isVisible()) await byHand.click(); // the form stays in hand mode after an Entry
  await form.getByLabel("Food").fill(food);
  await form.getByLabel("Calories").fill(calories);
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(p.getByRole("region", { name: "Entries" }).getByText(food)).toBeVisible();
}

const entries = (p: Page) => p.getByRole("region", { name: "Entries" });

await c.check("an Entry logged offline shows at once and reaches the backend once back online", async () => {
  db.reset();
  const p = await app.open("asher");
  c.watch(p);
  await expect(p.getByText("Nothing logged yet today.")).toBeVisible();
  await setOffline(p, true);
  await logByHand(p, "Offline apple", "95");
  await logByHand(p, "Offline cheese", "110");
  await p.waitForTimeout(300);
  expect(await backendEntries("asher")).toEqual([]);
  await setOffline(p, false);
  await expect.poll(() => backendEntries("asher")).toEqual(["Offline apple", "Offline cheese"]);
  await p.context().close();
});

await c.check("the service worker opens the app offline, with the Day from this device", async () => {
  db.reset();
  const p = await app.open("asher", { serviceWorkers: true });
  c.watch(p);
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await logByHand(p, "Online toast", "80");
  await expect.poll(() => backendEntries("asher")).toEqual(["Online toast"]);
  await setOffline(p, true);
  await p.reload();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(entries(p).getByText("Online toast")).toBeVisible();
  await p.context().close();
});

await c.check("an Entry logged offline survives a reload and syncs when back online", async () => {
  db.reset();
  const p = await app.open("asher", { serviceWorkers: true });
  c.watch(p);
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(p.getByText("Nothing logged yet today.")).toBeVisible();
  await setOffline(p, true);
  await logByHand(p, "Trail mix", "170");
  await p.reload(); // like closing the app on a train and opening it again
  await expect(entries(p).getByText("Trail mix")).toBeVisible();
  expect(await backendEntries("asher")).toEqual([]);
  await setOffline(p, false);
  await expect.poll(() => backendEntries("asher")).toEqual(["Trail mix"]);
  await p.context().close();
});

await c.check("a change on the phone shows on the desktop when it comes back to the front", async () => {
  db.reset();
  const phone = await app.open("asher");
  const desktop = await app.open("asher", { device: "desktop" });
  c.watch(desktop);
  await expect(desktop.getByText("Nothing logged yet today.")).toBeVisible();
  await logByHand(phone, "Phone banana", "105");
  await expect.poll(() => backendEntries("asher")).toEqual(["Phone banana"]);
  await desktop.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(entries(desktop).getByText("Phone banana")).toBeVisible();
  // And back: an Entry from the desktop reaches the phone when it becomes visible again.
  await logByHand(desktop, "Desk almonds", "160");
  await expect.poll(() => backendEntries("asher")).toEqual(["Phone banana", "Desk almonds"]);
  await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(entries(phone).getByText("Desk almonds")).toBeVisible();
  await phone.context().close();
  await desktop.context().close();
});

c.report();
await app.close();
