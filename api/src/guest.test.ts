// The Guest estimate endpoint (Seam 2, Bedrock stubbed): unauthenticated, capped per IP and in
// total per day, and with no way to reach Member or Library data.
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";
import { TEST_CAPS, guestHarness } from "./testing/guestHarness";

const h = harness();
const g = guestHarness();
beforeEach(() => {
  h.reset();
  g.reset();
  h.bedrock.reply(JSON.stringify(EGGS));
});

const EGGS = { carbs: 1.2, protein: 12.6, fat: 10.1, fiber: 0, sodium: 342, iron: 1.7, calories: 182, servingGrams: 122 };
const { servingGrams: _g, ...EGGS_NUTRITION } = EGGS;

describe("Guest estimate", () => {
  it("estimates a Food with no sign-in, through the same estimate core as Members", async () => {
    const r = await g.post({ text: "2 eggs scrambled" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ name: "2 eggs scrambled", nutrition: EGGS_NUTRITION, servingGrams: 122, yieldRatio: null, units: [] });
    expect(h.bedrock.lastPrompt()).toContain("2 eggs scrambled");
  });
});

const IP_LIMIT = `Guest estimates are limited to ${TEST_CAPS.perIp} a day. Sign in for more, or type the nutrition by hand.`;

describe("per-IP daily cap", () => {
  it("refuses an IP's estimate past the cap with a clear message, without asking Bedrock", async () => {
    for (let i = 0; i < TEST_CAPS.perIp; i++) expect((await g.post({ text: "apple" }, { ip: "198.51.100.4" })).status).toBe(200);
    const asked = h.bedrock.calls.length;
    const r = await g.post({ text: "apple" }, { ip: "198.51.100.4" });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: "LimitReached", message: IP_LIMIT });
    expect(h.bedrock.calls.length).toBe(asked);
  });

  it("counts each IP on its own", async () => {
    for (let i = 0; i < TEST_CAPS.perIp; i++) await g.post({ text: "apple" }, { ip: "198.51.100.4" });
    expect((await g.post({ text: "apple" }, { ip: "198.51.100.5" })).status).toBe(200);
  });

  it("starts over the next (UTC) day", async () => {
    const day1 = new Date("2026-11-02T23:00:00Z");
    for (let i = 0; i < TEST_CAPS.perIp; i++) await g.post({ text: "apple" }, { ip: "198.51.100.4", now: day1 });
    expect((await g.post({ text: "apple" }, { ip: "198.51.100.4", now: day1 })).status).toBe(429);
    expect((await g.post({ text: "apple" }, { ip: "198.51.100.4", now: new Date("2026-11-03T00:05:00Z") })).status).toBe(200);
  });

  it("treats one IPv6 /64 as one Guest, since a device can rotate addresses inside it", async () => {
    for (let i = 0; i < TEST_CAPS.perIp; i++) await g.post({ text: "apple" }, { ip: `2001:db8:1:2::${i + 1}` });
    expect((await g.post({ text: "apple" }, { ip: "2001:db8:1:2:abcd:ef01:2345:6789" })).status).toBe(429);
    expect((await g.post({ text: "apple" }, { ip: "2001:db8:1:3::1" })).status).toBe(200);
  });

  it("doesn't keep the IP itself, and counters expire after a couple of days", async () => {
    await g.post({ text: "apple" }, { ip: "198.51.100.4", now: new Date("2026-11-02T12:00:00Z") });
    expect(g.caps.dump().length).toBeGreaterThan(0);
    const rows = JSON.stringify(g.caps.dump());
    expect(rows).not.toContain("198.51.100.4");
    for (const r of g.caps.dump()) expect(r.expiresAt).toBe(Date.parse("2026-11-04T00:00:00Z") / 1000);
  });
});

const ALL_USED = "Guest estimates are used up for today. Try again tomorrow, sign in, or type the nutrition by hand.";

describe("global daily ceiling", () => {
  it("refuses every Guest once the day's total is used, with its own message, without asking Bedrock", async () => {
    for (let i = 0; i < TEST_CAPS.ceiling; i++) expect((await g.post({ text: "apple" }, { ip: `192.0.2.${i}` })).status).toBe(200);
    const asked = h.bedrock.calls.length;
    const r = await g.post({ text: "apple" }, { ip: "192.0.2.200" });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: "LimitReached", message: ALL_USED });
    expect(h.bedrock.calls.length).toBe(asked);
  });

  it("an IP refused by its own cap doesn't use up the day's total", async () => {
    for (let i = 0; i < TEST_CAPS.perIp + 10; i++) await g.post({ text: "apple" }, { ip: "198.51.100.4" });
    for (let i = 0; i < TEST_CAPS.ceiling - TEST_CAPS.perIp; i++) expect((await g.post({ text: "apple" }, { ip: `192.0.2.${i}` })).status).toBe(200);
    expect((await g.post({ text: "apple" }, { ip: "192.0.2.99" })).status).toBe(429);
  });
});

describe("Guests can't reach Member or Library data", () => {
  async function seedMemberData() {
    await h.call(h.A, "putDay", { input: { date: "2026-11-02", entries: [{ id: "e1", meal: "lunch", name: "Secret soup", nutrition: EGGS_NUTRITION }] } });
    h.db.seed({ PK: "HOUSEHOLD", SK: "FOOD#f1", name: "Household chili" });
    return h.db.dump();
  }

  it("no request shape reads or writes the Member table, and no reply carries its data", async () => {
    const before = await seedMemberData();
    const replies = [
      await g.post(undefined, { method: "GET", path: "/days" }),
      await g.post({ query: "{ days(from: \"2026-11-01\", to: \"2026-11-03\") { entries { name } } library { name } }" }, { path: "/graphql" }),
      await g.post({ text: "Secret soup" }, { method: "GET", path: "/estimate" }),
      await g.post({ text: "MEMBER#member-a DAY#2026-11-02" }),
      await g.post({ text: "HOUSEHOLD", username: "member-a", fieldName: "days" }),
      await g.post(undefined, { path: "/estimate/../library" }),
    ];
    expect(h.db.dump()).toEqual(before);
    const seen = JSON.stringify(replies);
    expect(seen).not.toContain("Secret soup\"");
    expect(seen).not.toContain("Household chili");
    expect(replies.slice(0, 3).map((r) => r.status)).toEqual([404, 404, 404]);
    expect(replies[5].status).toBe(404);
  });

  it("the Guest Lambda only ever talks to its cap counter table", async () => {
    await seedMemberData();
    await g.post({ text: "apple" });
    for (let i = 0; i < TEST_CAPS.perIp + 1; i++) await g.post({ text: "pear" }, { ip: "198.51.100.9" });
    expect(g.tables.length).toBeGreaterThan(0);
    expect(new Set(g.tables)).toEqual(new Set(["test-guest-caps"]));
  });
});

describe("Guest requests", () => {
  it("an empty or missing Food is refused and doesn't use an estimate", async () => {
    for (const body of [{ text: "   " }, {}, { text: 42 }]) {
      const r = await g.post(body, { ip: "198.51.100.7" });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: "ValidationError", message: "Type a Food to estimate" });
    }
    expect(h.bedrock.calls).toHaveLength(0);
    expect(g.caps.dump()).toEqual([]);
  });

  it("a body that isn't a JSON object, or is too big, is refused before anything is counted", async () => {
    expect((await g.post(undefined, { raw: "not json" })).status).toBe(400);
    expect((await g.post(undefined, { raw: "[1,2]" })).status).toBe(400);
    expect((await g.post(undefined, { raw: JSON.stringify({ text: "x".repeat(5000) }) })).status).toBe(413);
    expect(g.caps.dump()).toEqual([]);
  });

  it("asks for a Yield ratio only when the Food is a recipe ingredient", async () => {
    h.bedrock.reply(JSON.stringify({ ...EGGS, yieldRatio: 2.5 }));
    expect((await g.post({ text: "dry rice", ingredient: true })).body.yieldRatio).toBe(2.5);
    expect((await g.post({ text: "dry rice" })).body.yieldRatio).toBeNull();
  });

  it("estimates exactly an amount in a picked unit, like the Member estimate; a unit it doesn't offer is a 400", async () => {
    h.bedrock.reply(JSON.stringify({ ...EGGS, servingGrams: 237 }));
    expect((await g.post({ text: "rice", amount: 1.5, unit: "cup" })).body.servingGrams).toBe(237);
    expect(h.bedrock.lastPrompt()).toContain("Amount: 1 1/2 cup");
    expect((await g.post({ text: "rice", amount: 1, unit: "bucket" })).status).toBe(400);
  });

  it("a Bedrock failure is a plain 503 with the usual message", async () => {
    h.bedrock.fail(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
    const r = await g.post({ text: "apple" });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "Unavailable", message: "Couldn't estimate that right now. Try again, or type the nutrition by hand." });
  });

  it("replies are never cached", async () => {
    expect((await g.post({ text: "apple" })).headers["cache-control"]).toBe("no-store");
  });
});
