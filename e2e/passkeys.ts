// Passkey sign-in (ticket 03): add a passkey after a password sign-in, then sign in with it; the
// password stays as the backup; sign out. A Chromium virtual authenticator stands in for Face ID,
// so the real @simplewebauthn/browser + WebAuthn path runs against the fake Cognito.
// Not covered: real Face ID, iCloud Keychain or phone-QR passkeys (check on device after deploy).
import { expect } from "playwright/test";
import { launch } from "./app";
import { PASSWORD, passkeysOf, setPasskeys } from "./backend";
import { checklist, shot, tab } from "./lib";

const app = await launch();
const c = checklist("passkeys");

await c.check("with no passkey yet, Face ID sign-in says to use the password once", async () => {
  setPasskeys("asher", []);
  const p = await app.open("asher", { signedOut: true, authenticator: true });
  c.watch(p);
  await p.getByLabel("Username").fill("asher");
  await p.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(p.getByRole("alert")).toHaveText("No passkey on this account yet. Sign in with your password once, then add one in Profile.");
  await shot(p, "passkeys-login-phone");
  await p.context().close();
});

await c.check("signs in with the password, adds a passkey in Profile, then signs in with it", async () => {
  setPasskeys("asher", []);
  const p = await app.open("asher", { signedOut: true, authenticator: true });
  c.watch(p);
  await p.getByLabel("Username").fill("asher");
  await p.getByRole("button", { name: "Use password instead" }).click();
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in with password" }).click();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();

  await tab(p, "Profile");
  const section = p.getByRole("region", { name: "Passkeys" });
  await expect(section.getByText("No passkeys yet.")).toBeVisible();
  await section.getByRole("button", { name: "Add a passkey" }).click();
  await expect(section.getByText("1 passkey on your account.")).toBeVisible();
  if (passkeysOf("asher").length !== 1) throw new Error(`stored ${passkeysOf("asher")}`);
  await shot(p, "passkeys-profile-phone");

  await p.getByRole("button", { name: "Sign out" }).click();
  // The device remembers who signed in last, and goes back to the passkey button.
  await expect(p.getByLabel("Username")).toHaveValue("asher");
  await p.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(p.getByRole("heading", { name: "Today" })).toBeVisible();
  await p.context().close();
});

await c.check("desktop offers a passkey or the password, and a wrong password stays signed out", async () => {
  setPasskeys("aubyn", []);
  const p = await app.open("aubyn", { signedOut: true, device: "desktop" });
  c.watch(p);
  await p.getByLabel("Username").fill("aubyn");
  await expect(p.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  await p.getByRole("button", { name: "Use password instead" }).click();
  await p.getByLabel("Password").fill("wrong");
  await p.getByRole("button", { name: "Sign in with password" }).click();
  await expect(p.getByRole("alert")).toHaveText("Incorrect username or password.");
  await shot(p, "passkeys-login-desktop-password");
  await p.getByRole("button", { name: "Use a passkey instead" }).click();
  await expect(p.getByLabel("Password")).toHaveCount(0);
  await p.context().close();
});

c.report();
await app.close();
