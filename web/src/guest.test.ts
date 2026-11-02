import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateKey } from "@nutrisage/shared";

// Guest mode at the data/session layer: the same api/days and api/estimate functions Today uses,
// answered from browser storage (Days) and the Guest estimate endpoint (estimates) for a Guest.

const CONFIG = {
  region: "us-west-1", userPoolId: "us-west-1_TEST", clientId: "client-1",
  graphqlUrl: "https://api.example/graphql", guestEstimateUrl: "https://guest.example",
};

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let storage: MemoryStorage;
let requests: { url: string; body: any }[];
let guestReply: { status: number; body: unknown };

async function launch() {
  vi.resetModules();
  await (await import("./config")).loadConfig();
  return {
    session: await import("./session"),
    days: await import("./api/days"),
    estimate: await import("./api/estimate"),
  };
}

beforeEach(() => {
  storage = new MemoryStorage();
  requests = [];
  guestReply = { status: 200, body: { name: "apple", nutrition: { carbs: 25, protein: 0, fat: 0, fiber: 4, sodium: 2, iron: 0.2, calories: 95 }, servingGrams: 182, yieldRatio: null } };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/config.json") return new Response(JSON.stringify(CONFIG));
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "https://guest.example/estimate") return new Response(JSON.stringify(guestReply.body), { status: guestReply.status });
    throw new Error(`unexpected request to ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const today = dateKey(new Date());

describe("a Guest", () => {
  it("starts with demo Days, read through the same days API Today uses, with no server call", async () => {
    const { session, days } = await launch();
    expect(session.isGuest()).toBe(false);
    session.enterGuest();
    expect(session.isGuest()).toBe(true);
    const [d] = await days.getDays(today, today);
    expect(d.date).toBe(today);
    expect(d.entries).toHaveLength(3);
    expect(requests).toEqual([]);
  });

  it("logs Days on this device only, and they survive a relaunch", async () => {
    const first = await launch();
    first.session.enterGuest();
    const [d] = await first.days.getDays(today, today);
    await first.days.putDay({ ...d, entries: [...d.entries, { id: "x", meal: "snack", name: "Pear", nutrition: d.entries[0].nutrition }] });
    const again = await launch();
    expect(again.session.isGuest()).toBe(true);
    const [back] = await again.days.getDays(today, today);
    expect(back.entries.map((e) => e.name)).toContain("Pear");
    expect(requests).toEqual([]);
  });

  it("doesn't reseed over their own logging when they come back", async () => {
    const first = await launch();
    first.session.enterGuest();
    await first.days.putDay({ date: today, entries: [] });
    const again = await launch();
    again.session.enterGuest();
    expect((await again.days.getDays(today, today))[0].entries).toEqual([]);
  });

  it("estimates through the Guest endpoint, never the Member API", async () => {
    const { session, estimate } = await launch();
    session.enterGuest();
    const r = await estimate.estimate("apple");
    expect(r.servingGrams).toBe(182);
    expect(requests).toEqual([{ url: "https://guest.example/estimate", body: { text: "apple" } }]);
  });

  it("sees the server's limit message as is", async () => {
    const { session, estimate } = await launch();
    session.enterGuest();
    guestReply = { status: 429, body: { error: "LimitReached", message: "Guest estimates are limited to 20 a day. Sign in for more, or type the nutrition by hand." } };
    await expect(estimate.estimate("apple")).rejects.toThrow("Guest estimates are limited to 20 a day. Sign in for more, or type the nutrition by hand.");
  });

  it("gets the usual message when the Guest endpoint can't be reached", async () => {
    const { session, estimate } = await launch();
    session.enterGuest();
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/config.json") return new Response(JSON.stringify(CONFIG));
      throw new TypeError("Failed to fetch");
    });
    await expect(estimate.estimate("apple")).rejects.toThrow("Couldn't estimate that right now");
  });

  it("leaving Guest mode deletes the Guest's data from this device", async () => {
    const { session, days } = await launch();
    session.enterGuest();
    await days.putDay({ date: today, entries: [] });
    session.leaveGuest();
    expect(session.isGuest()).toBe(false);
    expect([...storage.m.keys()].filter((k) => k.startsWith("nutrisage.guest"))).toEqual([]);
  });

  it("tells listeners when Guest mode starts and ends", async () => {
    const { session } = await launch();
    const seen: boolean[] = [];
    session.onSessionChange(() => seen.push(session.isGuest()));
    session.enterGuest();
    session.leaveGuest();
    expect(seen).toEqual([true, false]);
  });
});
