// Ticket 10: Guest mode. Try NutriSage without signing in: demo Days and Library on this device
// only, estimates through the capped Guest endpoint, and no Member data anywhere.
import { expect } from "playwright/test";
import { launch, todayKey } from "./app";
import { GUEST_IP_CAP, bedrock, calls, guestCalls, resetGuestCaps, seed } from "./backend";
import { checklist, shot, tab } from "./lib";

await seed(todayKey()); // asher's Day: a Guest must never see it
const app = await launch();
const c = checklist("guest");

const PEAR = { carbs: 27, protein: 0.6, fat: 0.2, fiber: 5.5, sodium: 2, iron: 0.3, calories: 101, servingGrams: 178 };

async function enterAsGuest(opts: { device?: "phone" | "desktop"; dark?: boolean } = {}) {
  const p = await app.open("guest", { signedOut: true, ...opts });
  c.watch(p);
  await p.getByRole("button", { name: "Try it as a Guest" }).waitFor();
  if (!opts.device && !opts.dark) await shot(p, "guest-00-login");
  await p.getByRole("button", { name: "Try it as a Guest" }).click();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();
  return p;
}

await c.check("enters as a Guest from the sign-in screen and sees demo Entries, not a Member's", async () => {
  const p = await enterAsGuest();
  await expect(p.getByText(/Guest mode/)).toBeVisible();
  const entries = p.getByRole("region", { name: "Entries" });
  await expect(entries.getByText("2 eggs and toast")).toBeVisible();
  await expect(entries.getByText("Oatmeal with berries")).toHaveCount(0);
  await shot(p, "guest-01-today");
  await p.context().close();
});

await c.check("logs a demo Entry with an estimate, on this device only, then hits the cap and sees the message", async () => {
  resetGuestCaps();
  const before = calls.length;
  const p = await enterAsGuest();
  const form = p.getByRole("form", { name: "Add an Entry" });
  const entries = p.getByRole("region", { name: "Entries" });
  for (let i = 1; i <= GUEST_IP_CAP; i++) {
    bedrock.reply(JSON.stringify(PEAR));
    await form.getByLabel("Meal").selectOption("snack");
    await form.getByLabel("Food").fill(`Pear ${i}`);
    await form.getByLabel("Food").press("Enter");
    await expect(entries.getByText(`Pear ${i}`)).toBeVisible();
  }
  await expect(entries.getByText("178 g").first()).toBeVisible();
  await form.getByLabel("Food").fill("One more pear");
  await form.getByLabel("Food").press("Enter");
  await expect(p.getByRole("alert")).toHaveText(`Guest estimates are limited to ${GUEST_IP_CAP} a day. Sign in for more, or type the nutrition by hand.`);
  await expect(form.getByLabel("Food")).toHaveValue("One more pear");
  await shot(p, "guest-02-limit");
  if (calls.length !== before) throw new Error("a Guest reached the Member API");
  if (!guestCalls.some((g) => (g.body as { text?: string })?.text === "Pear 1")) throw new Error("estimate didn't go to the Guest endpoint");
  // Typing nutrition by hand is never capped.
  await form.getByRole("button", { name: "Type nutrition by hand" }).click();
  await form.getByLabel("Food").fill("Pear by hand");
  await form.getByLabel("Calories").fill("100");
  await form.getByRole("button", { name: "Add Entry" }).click();
  await expect(entries.getByText("Pear by hand")).toBeVisible();
  // Still there after a reload: stored on this device.
  await p.reload();
  await expect(p.getByRole("region", { name: "Entries" }).getByText("Pear by hand")).toBeVisible();
  await p.context().close();
});

await c.check("leaving Guest mode deletes the Guest's data and returns to sign-in", async () => {
  const p = await enterAsGuest();
  await tab(p, "Profile");
  await shot(p, "guest-03-profile");
  p.once("dialog", (d) => void d.accept());
  await p.getByRole("button", { name: "Leave Guest mode" }).click();
  await expect(p.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("nutrisage.guest")));
  if (left.length) throw new Error(`Guest data left behind: ${left.join(", ")}`);
  await p.context().close();
});

await c.check("desktop and dark screenshots", async () => {
  const d = await enterAsGuest({ device: "desktop" });
  await shot(d, "guest-04-desktop");
  await d.context().close();
  const k = await enterAsGuest({ dark: true });
  await shot(k, "guest-05-dark");
  await k.context().close();
});

c.report();
await app.close();
