// Change password (Profile): a Member swaps the one-time password for their own, the form refuses a
// weak or mismatched one before calling Cognito, a wrong current password reads plainly, and the
// new password is the one that signs in afterwards.
import { expect } from "playwright/test";
import { launch } from "./app";
import { PASSWORD, passwordOf, resetPassword } from "./backend";
import { checklist, shot, tab } from "./lib";

const app = await launch();
const c = checklist("password");
const NEW = "My own password 2026";

async function form(p: import("playwright").Page) {
  await tab(p, "Profile");
  const card = p.getByRole("region", { name: "Password" });
  await card.getByRole("button", { name: "Change password" }).click();
  return card;
}

await c.check("refuses a weak or mismatched new password without changing anything", async () => {
  resetPassword("asher");
  const p = await app.open("asher");
  c.watch(p);
  const card = await form(p);
  await card.getByLabel("Current password").fill(PASSWORD);
  await card.getByLabel("New password", { exact: true }).fill("short");
  await card.getByLabel("New password again").fill("short");
  await card.getByRole("button", { name: "Save new password" }).click();
  await expect(card.getByRole("alert")).toHaveText("Use at least 16 characters.");
  await card.getByLabel("New password", { exact: true }).fill(NEW);
  await card.getByLabel("New password again").fill(NEW + "x");
  await card.getByRole("button", { name: "Save new password" }).click();
  await expect(card.getByRole("alert")).toHaveText("The two new passwords don't match.");
  if (passwordOf("asher") !== PASSWORD) throw new Error("password changed");
  await shot(p, "password-form-phone");
  await p.context().close();
});

await c.check("a wrong current password reads plainly", async () => {
  resetPassword("asher");
  const p = await app.open("asher");
  c.watch(p);
  const card = await form(p);
  await card.getByLabel("Current password").fill("not-my-password");
  await card.getByLabel("New password", { exact: true }).fill(NEW);
  await card.getByLabel("New password again").fill(NEW);
  await card.getByRole("button", { name: "Save new password" }).click();
  await expect(card.getByRole("alert")).toHaveText("Your current password is wrong.");
  if (passwordOf("asher") !== PASSWORD) throw new Error("password changed");
  await p.context().close();
});

await c.check("changes the password, and only the new one signs in after", async () => {
  resetPassword("asher");
  const p = await app.open("asher");
  c.watch(p);
  const card = await form(p);
  await card.getByLabel("Current password").fill(PASSWORD);
  await card.getByLabel("New password", { exact: true }).fill(NEW);
  await card.getByLabel("New password again").fill(NEW);
  await card.getByRole("button", { name: "Save new password" }).click();
  await expect(card.getByRole("status")).toHaveText(/Password changed/);
  await expect(card.getByLabel("Current password")).toHaveCount(0);
  if (passwordOf("asher") !== NEW) throw new Error(`stored ${passwordOf("asher")}`);
  await shot(p, "password-changed-phone");

  await p.getByRole("button", { name: "Sign out" }).click();
  await p.getByLabel("Username").fill("asher");
  await p.getByRole("button", { name: "Use password instead" }).click();
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in with password" }).click();
  await expect(p.getByRole("alert")).toHaveText("Incorrect username or password.");
  await p.getByLabel("Password").fill(NEW);
  await p.getByRole("button", { name: "Sign in with password" }).click();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();
  await p.context().close();
  resetPassword("asher");
});

c.report();
await app.close();
