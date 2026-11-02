import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateKey, foodEdit } from "@nutrisage/shared";

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
    goals: await import("./api/goals"),
    library: await import("./api/library"),
    recipes: await import("./api/recipes"),
    store: await import("./guest/store"),
    favorites: await import("./api/favorites"),
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

  it("has demo goals and keeps the goals they set, on this device only", async () => {
    const { session, goals } = await launch();
    session.enterGuest();
    expect((await goals.getGoals()).calories).toBe(2000);
    await goals.putGoals({ ...(await goals.getGoals()), calories: 1800 });
    const again = await launch();
    expect((await again.goals.getGoals()).calories).toBe(1800);
    expect(requests).toEqual([]);
  });

  it("keeps Favorites on this device only: star, bump, unstar, across a relaunch", async () => {
    const { session, favorites, library } = await launch();
    session.enterGuest();
    const [a, b] = await library.getLibrary();
    expect(await favorites.getFavorites()).toEqual([]);
    await favorites.putFavorite({ libraryId: a.id, lastUsed: 100 });
    await favorites.putFavorite({ libraryId: b.id, lastUsed: 200 });
    // An older bump never moves lastUsed backwards, like the Member API.
    expect(await favorites.putFavorite({ libraryId: b.id, lastUsed: 150 })).toEqual({ libraryId: b.id, lastUsed: 200 });
    const again = await launch();
    expect(await again.favorites.getFavorites()).toEqual([{ libraryId: a.id, lastUsed: 100 }, { libraryId: b.id, lastUsed: 200 }]);
    await again.favorites.deleteFavorite(a.id);
    expect(await again.favorites.getFavorites()).toEqual([{ libraryId: b.id, lastUsed: 200 }]);
    expect(requests).toEqual([]);
  });

  it("keeps Favorites through every other Guest write (Days, goals, a new Food)", async () => {
    const { session, favorites, library, days, goals } = await launch();
    session.enterGuest();
    const [a] = await library.getLibrary();
    await favorites.putFavorite({ libraryId: a.id, lastUsed: 100 });
    await days.putDay({ date: today, entries: [] });
    await goals.putGoals({ ...(await goals.getGoals()), calories: 1900 });
    await library.putFood(a.id, { ...foodEdit(a), name: `${a.name} (edited)` });
    expect(await favorites.getFavorites()).toEqual([{ libraryId: a.id, lastUsed: 100 }]);
  });

  it("deleting a Food from the device Library also drops its Favorite", async () => {
    const { session, favorites, library } = await launch();
    session.enterGuest();
    const [a, b] = await library.getLibrary();
    await favorites.putFavorite({ libraryId: a.id, lastUsed: 100 });
    await favorites.putFavorite({ libraryId: b.id, lastUsed: 200 });
    await library.deleteFood(a.id);
    expect(await favorites.getFavorites()).toEqual([{ libraryId: b.id, lastUsed: 200 }]);
  });

  it("estimates through the Guest endpoint, never the Member API", async () => {
    const { session, estimate } = await launch();
    session.enterGuest();
    const r = await estimate.estimate("apple");
    expect(r.servingGrams).toBe(182);
    expect(requests).toEqual([{ url: "https://guest.example/estimate", body: { text: "apple" } }]);
  });

  it("has the demo Library as Foods per gram, from this device only", async () => {
    const { session, library } = await launch();
    session.enterGuest();
    const foods = await library.getLibrary();
    expect(foods).toHaveLength(8);
    expect(foods.find((f) => f.name === "Apple")?.units).toEqual([{ label: "serving", grams: 182 }, { label: "g", grams: 1 }]);
    expect(requests).toEqual([]);
  });

  it("adds what they estimate to their own device Library, deduplicated by name", async () => {
    const { session, estimate, library } = await launch();
    session.enterGuest();
    guestReply = { status: 200, body: { name: "Pear", nutrition: { carbs: 27, protein: 0.6, fat: 0.2, fiber: 5.5, sodium: 2, iron: 0.3, calories: 101 }, servingGrams: 178, yieldRatio: null, units: [{ label: "slice", grams: 20 }] } };
    const r = await estimate.estimate("Pear");
    expect(r.food).toMatchObject({ name: "Pear", units: [{ label: "serving", grams: 178 }, { label: "g", grams: 1 }, { label: "slice", grams: 20 }] });
    const again = await estimate.estimate("PEAR");
    expect(again.food?.id).toBe(r.food?.id);
    const names = (await (await launch()).library.getLibrary()).map((f) => f.name);
    expect(names.filter((n) => n.toLowerCase() === "pear")).toEqual(["Pear"]);
    expect(names).toHaveLength(9);
    expect(requests.every((q) => q.url === "https://guest.example/estimate")).toBe(true);
  });

  it("an older device Library (one serving each, no units) still reads as Foods", async () => {
    storage.setItem("nutrisage.guest", "1");
    storage.setItem("nutrisage.guest.data", JSON.stringify({ days: {}, goals: {}, library: [{ id: "demo-apple", name: "Apple", meal: "snack", nutrition: { carbs: 25, protein: 0, fat: 0, fiber: 4, sodium: 2, iron: 0.2, calories: 95 } }] }));
    const { library } = await launch();
    const [apple] = await library.getLibrary();
    expect(apple).toMatchObject({ id: "demo-apple", name: "Apple", units: [{ label: "serving", grams: 1 }], nutrition: { calories: 95 } });
  });

  it("estimates a Recipe ingredient through the Guest endpoint, asking for its Yield ratio", async () => {
    const { session, estimate } = await launch();
    session.enterGuest();
    await estimate.estimate("dry rice", { ingredient: true });
    expect(requests).toEqual([{ url: "https://guest.example/estimate", body: { text: "dry rice", ingredient: true } }]);
  });

  it("saves a Recipe to their own device Recipe Book, with the same checks as a Member", async () => {
    const { session, recipes, store } = await launch();
    session.enterGuest();
    const n = { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 100 };
    const chili = { name: "Chili", ingredients: [{ libraryId: null, name: "Beans", amount: 1, unit: "can", grams: 400, nutrition: n }], preparedGrams: 380 };
    const saved = await recipes.addRecipe("r1", chili);
    expect(saved).toMatchObject({ id: "r1", name: "Chili", preparedGrams: 380 });
    expect((await launch()).store.guestRecipes()).toEqual([saved]);
    await expect(recipes.addRecipe("r2", { ...chili, name: "chili" })).rejects.toThrow("The Recipe Book already has Chili");
    await expect(recipes.addRecipe("r3", { ...chili, ingredients: [] })).rejects.toThrow("Add at least one ingredient");
    expect(store.guestRecipes()).toHaveLength(1);
    expect(requests).toEqual([]);
  });

  it("edits and deletes Recipes in their device Recipe Book (Favorite of it goes too); nesting stays one level deep", async () => {
    const { session, recipes, favorites, store } = await launch();
    session.enterGuest();
    const n = { carbs: 0, protein: 0, fat: 0, fiber: 0, sodium: 0, iron: 0, calories: 100 };
    const beans = { libraryId: null, name: "Beans", amount: 1, unit: "can", grams: 400, nutrition: n };
    const chili = await recipes.addRecipe("r1", { name: "Chili", ingredients: [beans], preparedGrams: 400 });
    expect(await recipes.getRecipes()).toEqual([chili]);
    const edited = await recipes.putRecipe("r1", { name: "Chili", ingredients: [beans, beans], preparedGrams: 700 });
    expect(edited).toMatchObject({ id: "r1", preparedGrams: 700, ingredients: [beans, beans] });
    await expect(recipes.putRecipe("nope", { name: "X", ingredients: [beans] })).rejects.toThrow("That Recipe is no longer in the Recipe Book");

    const inner = { ...beans, libraryId: "r1", name: "Chili", ingredients: [beans] };
    await recipes.addRecipe("r2", { name: "Burrito", ingredients: [inner] });
    await expect(recipes.addRecipe("r3", { name: "Plate", ingredients: [{ ...beans, libraryId: "r2", name: "Burrito" }] })).rejects.toThrow("Burrito already has a Recipe in it");

    await favorites.putFavorite({ libraryId: "r1", lastUsed: 5 });
    expect(await recipes.deleteRecipe("r1")).toBe("r1");
    expect(store.guestRecipes().map((r) => r.id)).toEqual(["r2"]);
    expect(store.guestFavorites()).toEqual([]);
    expect(requests).toEqual([]);
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
