import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foodEdit } from "@nutrisage/shared";

// Library edit for a Guest (ticket 15): the same api/library calls the Library screen uses, answered
// from this device's Guest Library. Members go to the API (api/src/libraryEdit.test.ts, e2e/libraryEdit.ts).

const CONFIG = { region: "us-west-1", userPoolId: "us-west-1_TEST", clientId: "client-1", graphqlUrl: "https://api.example/graphql", guestEstimateUrl: "https://guest.example" };
let requests: string[];

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  requests = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/config.json") return new Response(JSON.stringify(CONFIG));
    requests.push(url);
    throw new Error(`unexpected request to ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

async function launch() {
  vi.resetModules();
  await (await import("./config")).loadConfig();
  const session = await import("./session");
  return { session, library: await import("./api/library"), days: await import("./api/days") };
}

describe("a Guest edits their device Library", () => {
  it("edits a demo Food on this device, and the edit survives a relaunch", async () => {
    const { session, library } = await launch();
    session.enterGuest();
    const apple = (await library.getLibrary()).find((f) => f.name === "Apple")!;
    const saved = await library.putFood(apple.id, { ...foodEdit(apple), name: "Green apple", servingGrams: 200, units: [{ label: "slice", grams: 25 }] });
    expect(saved).toMatchObject({ id: apple.id, name: "Green apple", units: [{ label: "serving", grams: 200 }, { label: "g", grams: 1 }, { label: "slice", grams: 25 }] });
    const again = (await (await launch()).library.getLibrary()).find((f) => f.id === apple.id);
    expect(again).toEqual(saved);
    expect(requests).toEqual([]);
  });

  it("refuses a bad edit or a rename onto another Food, with the form's words", async () => {
    const { session, library } = await launch();
    session.enterGuest();
    const [a, b] = await library.getLibrary();
    await expect(library.putFood(a.id, { ...foodEdit(a), yieldRatio: 99 })).rejects.toThrow("Yield ratio must be more than 0 and at most 20");
    await expect(library.putFood(a.id, { ...foodEdit(a), name: b.name.toUpperCase() })).rejects.toThrow(`The Library already has ${b.name}`);
  });

  it("deletes a Food from this device; the Days that logged it keep their Entries", async () => {
    const { session, library, days } = await launch();
    session.enterGuest();
    const before = await library.getLibrary();
    const daysBefore = await days.getDays("2000-01-01", "2100-01-01");
    const logged = daysBefore.flatMap((d) => d.entries).find((e) => e.libraryId);
    const target = before.find((f) => f.id === logged?.libraryId) ?? before[0];
    expect(await library.deleteFood(target.id)).toBe(target.id);
    const after = await (await launch()).library.getLibrary();
    expect(after.map((f) => f.id)).toEqual(before.filter((f) => f.id !== target.id).map((f) => f.id));
    expect(await days.getDays("2000-01-01", "2100-01-01")).toEqual(daysBefore);
    expect(requests).toEqual([]);
  });
});
