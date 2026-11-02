// Opens the built web app (web/dist) in headless Chromium with every network call routed to
// the fake backend. Build first: npm run build:web (from the repo root).
//
//   const app = await launch();
//   const asher = await app.open("asher");                 // signed in, Today loaded
//   const login = await app.open("asher", { signedOut: true });
//   await app.close();
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { cognito, graphql } from "./backend";

export const ORIGIN = "https://nutrisage.test";
const GRAPHQL_URL = "https://e2e.appsync-api.us-west-1.amazonaws.com/graphql";
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

const CONFIG = { region: "us-west-1", userPoolId: "us-west-1_e2e", clientId: "e2e-client", graphqlUrl: GRAPHQL_URL };

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};

export interface OpenOptions {
  /** Start signed out (to test the sign-in screen). */
  signedOut?: boolean;
  /** Screen: an iPhone 13 (default) or a 1280x800 desktop browser. */
  device?: "phone" | "desktop";
  /** Dark color scheme. */
  dark?: boolean;
  /**
   * A virtual platform authenticator (stands in for Face ID / Touch ID) that always passes user
   * verification. Its passkeys live in this browser context only, like a real device's.
   */
  authenticator?: boolean;
  /** Let the app's service worker run (off by default, so routes see every request). */
  serviceWorkers?: boolean;
}

export async function launch() {
  if (!existsSync(path.join(DIST, "index.html"))) throw new Error("web/dist missing: run npm run build:web first");
  const browser: Browser = await chromium.launch();

  async function open(username: string, opts: OpenOptions = {}) {
    const screen = opts.device === "desktop" ? { viewport: { width: 1280, height: 800 } } : devices["iPhone 13"];
    const context = await browser.newContext({
      ...screen, serviceWorkers: opts.serviceWorkers ? "allow" : "block", timezoneId: "America/Los_Angeles", colorScheme: opts.dark ? "dark" : "light",
    });
    const page = await context.newPage();
    if (opts.authenticator) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      });
    }
    page.on("pageerror", (e) => console.log(`[${username}] pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") console.log(`[${username}] console: ${m.text()}`); });

    if (!opts.signedOut) {
      await context.addInitScript((u) => {
        if (localStorage.getItem("nutrisage.tokens")) return;
        localStorage.setItem("nutrisage.tokens", JSON.stringify({
          idToken: `fake-id.${u}`, accessToken: `fake-access.${u}`, refreshToken: `fake-refresh.${u}`,
          expiresAt: Date.now() + 3600_000, username: u,
        }));
      }, username);
    }

    await context.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/config.json") return route.fulfill({ json: CONFIG });
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === "/") file = path.join(DIST, "index.html");
      return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream" });
    });
    await context.route("https://cognito-idp.us-west-1.amazonaws.com/", async (route) => {
      const target = (route.request().headers()["x-amz-target"] ?? "").split(".").pop()!;
      const r = cognito(target, route.request().postDataJSON());
      return route.fulfill({ status: r.status, contentType: "application/x-amz-json-1.1", body: JSON.stringify(r.json) });
    });
    await context.route(GRAPHQL_URL, async (route) => {
      const { query, variables } = route.request().postDataJSON();
      return route.fulfill({ json: await graphql(route.request().headers()["authorization"], query, variables) });
    });

    await page.goto(ORIGIN + "/");
    return page;
  }

  return { browser, open, close: () => browser.close() };
}

/** Today's date key in the page's zone (Pacific), not this machine's. */
export function todayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type { Page };

const offlineContexts = new WeakMap<BrowserContext, { offline: boolean }>();

/**
 * Take a page's browser context off the network (or back on). Chromium's offline mode alone still
 * lets routed requests through, so every request this context makes (the page's and its service
 * worker's) is aborted too while offline.
 */
export async function setOffline(page: Page, offline: boolean) {
  const context = page.context();
  let gate = offlineContexts.get(context);
  if (!gate) {
    const g = { offline: false };
    gate = g;
    offlineContexts.set(context, g);
    // Registered last, so it runs before the fake-backend routes and falls back to them when online.
    await context.route("**/*", (route) => (g.offline ? route.abort("internetdisconnected") : route.fallback()));
  }
  gate.offline = offline;
  await context.setOffline(offline);
}

