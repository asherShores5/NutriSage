// The Member's data on this device: a local copy of the Days, goals, Meal windows and Favorites the screens have opened,
// saved in localStorage, plus the outbox that writes them through to the API (HoneyDo-style:
// local copy first, server is the sync layer). Screens read and write through useDay/useGoals;
// nothing here renders.
//
// - A change shows at once and is saved on the device before it is sent, so logging works offline
//   and survives closing the app. The outbox sends writes in order when the API answers again.
// - Opening the app, coming back to it (visible or focused) and going back online first send the
//   outbox, then reload every open Day, the goals, Meal windows and Favorites, so changes from other devices show up.
// - Every write carries the whole row: last write wins per Day. A row with a queued write keeps
//   the local copy over the server's until that write lands.
// - Except a Day changed here while this device may not hold the server's current copy (opened
//   offline, offline or unreachable since it last loaded, or the write itself had to wait): that
//   write is merged with the server's copy just before it's sent (mergeDays in shared, a three-way
//   merge against the copy the change started from), so it never wipes what another device
//   logged meanwhile.
// - Only a signed-in Member's copy is saved; it's dropped when a different Member (or nobody)
//   signs in on this device. A Guest's data already lives on the device (guest/store.ts, behind
//   the same api/ calls), so for a Guest this is an in-memory copy only.
import { bumpFavorites, daysByDate, mergeDays, toggleFavorite as toggled, type Day, type Favorite, type Goals, type MealWindows } from "@nutrisage/shared";
import { getDays, putDay } from "../api/days";
import { NetworkError } from "../api/errors";
import { deleteFavorite, getFavorites, putFavorite } from "../api/favorites";
import { getGoals, putGoals } from "../api/goals";
import { getMealWindows, putMealWindows } from "../api/mealWindows";
import { currentUsername, onAuthChange } from "../auth";
import { isGuest, onSessionChange } from "../session";
import { createOutbox, opRow, type Op } from "./outbox";

const CACHE = "nutrisage.cache.v1";
const OUTBOX = "nutrisage.outbox.v1";
/** Days kept on the device (newest first); older ones reload from the API when opened. */
const KEEP_DAYS = 62;
/** After a failed send, try again this often while writes are waiting (the "online" event alone misses weak signal). */
const RETRY_MS = 20_000;

interface Cache {
  /** Whose copy this is: `member:<username>`, `guest`, or nobody. */
  user?: string;
  days: Record<string, Day>;
  goals?: Goals;
  mealWindows?: MealWindows;
  favorites?: Favorite[];
  /**
   * Days with a queued write: the server copy the change started from (null: none, e.g. opened
   * offline) and whether the write must be merged with the server's copy when sent (see the top).
   */
  pending?: Record<string, { base: Day | null; merge: boolean }>;
  /** Days started empty here while offline: no server copy behind them yet. */
  offlineStarted?: string[];
}

const dayRow = (date: string) => `DAY#${date}`;
const GOALS_ROW = "GOALS";
const WINDOWS_ROW = "MEAL_WINDOWS";
/** Errors and edit counts for the Favorites as a whole (each Favorite is its own outbox row, FAV#<libraryId>). */
const FAVS_ROW = "FAVORITES";
const isFavOp = (op: Op) => op.type === "putFavorite" || op.type === "deleteFavorite";
const emptyDay = (date: string): Day => ({ date, entries: [], water: null, weight: null });

/** Who the data belongs to right now. Only a Member's copy is written to localStorage. */
const whoNow = () => (isGuest() ? "guest" : currentUsername() ? `member:${currentUsername()}` : undefined);
const persisted = (u: string | undefined) => !!u?.startsWith("member:");

let user = whoNow();
let cache: Cache = readCache(user);
/** Load or write errors per row, shown by the screen that row belongs to. */
let errors: Record<string, string | undefined> = {};
/** Bumped on every local change to a row, so a slower load can't land over a newer local edit. */
const edits = new Map<string, number>();
/** Dates open on some screen (ref-counted), reloaded on resume. */
const watched = new Map<string, number>();
let goalsWatched = false;
let windowsWatched = false;
let favoritesWatched = false;
/** Dates whose copy here came from the server since the API was last unreachable (in memory only). */
const fresh = new Set<string>();
let started = false;
let retry: ReturnType<typeof setTimeout> | undefined;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function readJSON<T>(key: string): T | undefined {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

function readCache(u: string | undefined): Cache {
  const c = persisted(u) ? readJSON<Cache>(CACHE) : undefined;
  return c && c.user === u ? { user: u, days: c.days ?? {}, goals: c.goals, mealWindows: c.mealWindows, favorites: c.favorites, pending: c.pending, offlineStarted: c.offlineStarted } : { user: u, days: {} };
}

function readOps(u: string | undefined): Op[] {
  const o = persisted(u) ? readJSON<{ user?: string; ops?: Op[] }>(OUTBOX) : undefined;
  return o && o.user === u ? (o.ops ?? []) : [];
}

function writeCache() {
  if (!persisted(user)) return;
  const days = Object.fromEntries(
    Object.entries(cache.days)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, KEEP_DAYS),
  );
  cache = { ...cache, days };
  try {
    localStorage.setItem(CACHE, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: the copy in memory still works for this session.
  }
}

function newOutbox(u: string | undefined) {
  return createOutbox({
    load: () => readOps(u),
    save: (ops) => {
      if (persisted(u)) localStorage.setItem(OUTBOX, JSON.stringify({ user: u, ops }));
    },
    send: (op) => {
      switch (op.type) {
        case "putDay": return sendDay(op.day);
        case "putGoals": return putGoals(op.goals);
        case "putMealWindows": return putMealWindows(op.windows);
        case "putFavorite": return putFavorite(op.favorite);
        case "deleteFavorite": return deleteFavorite(op.libraryId);
      }
    },
    onSent: (op, result, stillPending) => {
      if (stillPending) return;
      if (op.type === "putDay") {
        cache.days = { ...cache.days, [op.day.date]: result as Day };
        settled(op.day.date);
      }
      else if (op.type === "putGoals") cache.goals = result as Goals;
      else if (op.type === "putMealWindows") cache.mealWindows = result as MealWindows;
      else if (op.type === "putFavorite") {
        // The server keeps the newer last-used time (another device may have logged it later).
        const fav = result as Favorite;
        cache.favorites = cache.favorites?.map((f) => (f.libraryId === fav.libraryId ? fav : f));
      } else return;
      writeCache();
      emit();
    },
    onRejected: (op, e) => {
      errors = { ...errors, [isFavOp(op) ? FAVS_ROW : opRow(op)]: `Couldn't save: ${e.message}` };
      // Show what the server actually holds instead of the refused change.
      if (op.type === "putDay") void loadDay(op.day.date, true);
      else if (op.type === "putGoals") void loadGoals(true);
      else if (op.type === "putMealWindows") void loadMealWindows(true);
      else void loadFavorites(true);
      emit();
    },
    onReachable: (reachable) => {
      if (reachable) return;
      wentOffline();
      clearTimeout(retry);
      retry = setTimeout(() => void outbox.flush(), RETRY_MS);
    },
  });
}

let outbox = newOutbox(user);

/** The server's copy of a Day is now here (loaded or just written): nothing to merge for it. */
function settled(date: string) {
  const { [date]: _, ...rest } = cache.pending ?? {};
  cache.pending = rest;
  cache.offlineStarted = cache.offlineStarted?.filter((d) => d !== date);
  fresh.add(date);
}

/** The API can't be reached: no copy here can be trusted as current, and every queued Day write must merge. */
function wentOffline() {
  fresh.clear();
  if (!cache.pending) return;
  cache.pending = Object.fromEntries(Object.entries(cache.pending).map(([d, p]) => [d, { ...p, merge: true }]));
  writeCache();
}

/** Write a Day; one that may be behind the server's copy is merged with it first (see the top). */
async function sendDay(day: Day): Promise<Day> {
  const p = cache.pending?.[day.date];
  if (!p?.merge) return putDay(day);
  const [server] = await getDays(day.date, day.date);
  return putDay(mergeDays(day, server, p.base ?? undefined));
}

// Another Member signed in (or out), or Guest mode started or ended: drop the last copy (and,
// on sign out, the saved one and its queued writes) so nobody sees the last person's data.
function switchOwner() {
  const next = whoNow();
  if (next === user) return;
  if (persisted(user) && !persisted(next)) {
    localStorage.removeItem(CACHE);
    localStorage.removeItem(OUTBOX);
  }
  user = next;
  cache = readCache(user);
  errors = {};
  edits.clear();
  fresh.clear();
  outbox = newOutbox(user);
  emit();
  void resume();
}
onAuthChange(switchOwner);
onSessionChange(switchOwner);

const bump = (row: string) => {
  const n = (edits.get(row) ?? 0) + 1;
  edits.set(row, n);
  return n;
};

async function loadDay(date: string, keepError = false) {
  const row = dayRow(date);
  const at = edits.get(row) ?? 0;
  try {
    const [server] = await getDays(date, date);
    if ((edits.get(row) ?? 0) !== at || outbox.pendingFor(row)) return; // a newer local change wins
    cache.days = { ...cache.days, [date]: server ?? emptyDay(date) };
    settled(date);
    writeCache();
    if (!keepError) errors = { ...errors, [row]: undefined };
  } catch (e) {
    if (e instanceof NetworkError) {
      wentOffline();
      // Offline with nothing on the device yet: start the Day empty so logging still works.
      if (!cache.days[date]) {
        cache.days = { ...cache.days, [date]: emptyDay(date) };
        cache.offlineStarted = [...(cache.offlineStarted ?? []), date];
      }
    } else {
      errors = { ...errors, [row]: (e as Error).message };
    }
  }
  emit();
}

async function loadGoals(keepError = false) {
  const at = edits.get(GOALS_ROW) ?? 0;
  try {
    const server = await getGoals();
    if ((edits.get(GOALS_ROW) ?? 0) !== at || outbox.pendingFor(GOALS_ROW)) return;
    cache.goals = server;
    writeCache();
    if (!keepError) errors = { ...errors, [GOALS_ROW]: undefined };
  } catch (e) {
    if (!(e instanceof NetworkError)) errors = { ...errors, [GOALS_ROW]: (e as Error).message };
  }
  emit();
}

async function loadMealWindows(keepError = false) {
  const at = edits.get(WINDOWS_ROW) ?? 0;
  try {
    const server = await getMealWindows();
    if ((edits.get(WINDOWS_ROW) ?? 0) !== at || outbox.pendingFor(WINDOWS_ROW)) return;
    cache.mealWindows = server;
    writeCache();
    if (!keepError) errors = { ...errors, [WINDOWS_ROW]: undefined };
  } catch (e) {
    if (!(e instanceof NetworkError)) errors = { ...errors, [WINDOWS_ROW]: (e as Error).message };
  }
  emit();
}

/**
 * The server's Favorites with this device's queued Favorite writes laid over them. If a Favorite
 * changed here while loading, the local copy stays (the outbox will send it).
 */
async function loadFavorites(keepError = false) {
  const at = edits.get(FAVS_ROW) ?? 0;
  try {
    let list = await getFavorites();
    if ((edits.get(FAVS_ROW) ?? 0) !== at) return;
    for (const op of outbox.pending()) {
      if (op.type === "putFavorite") list = [...list.filter((f) => f.libraryId !== op.favorite.libraryId), op.favorite];
      else if (op.type === "deleteFavorite") list = list.filter((f) => f.libraryId !== op.libraryId);
    }
    cache.favorites = list;
    writeCache();
    if (!keepError) errors = { ...errors, [FAVS_ROW]: undefined };
  } catch (e) {
    if (e instanceof NetworkError) cache.favorites ??= [];
    else errors = { ...errors, [FAVS_ROW]: (e as Error).message };
  }
  emit();
}

let resuming: Promise<void> | undefined;

/** Send the outbox, then reload every open Day and the goals. One at a time. */
export function resume(): Promise<void> {
  resuming ??= (async () => {
    if (!user) return;
    await outbox.flush();
    // The first flush may have joined a send that started before the connection came back (and
    // failed with it): try once more now rather than waiting for the retry timer.
    if (outbox.pending().length) await outbox.flush();
    await Promise.all([
      ...[...watched.keys()].map((d) => loadDay(d)),
      goalsWatched ? loadGoals() : undefined,
      windowsWatched ? loadMealWindows() : undefined,
      favoritesWatched ? loadFavorites() : undefined,
    ]);
  })().finally(() => (resuming = undefined));
  return resuming;
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void resume());
  window.addEventListener("focus", () => void resume());
  window.addEventListener("online", () => void resume());
  window.addEventListener("offline", wentOffline);
  // Another device may write while this one is in the background: until the reload on return,
  // treat every copy here as possibly behind.
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && fresh.clear());
}

// ---- Days ------------------------------------------------------------------

export const getDay = (date: string): Day | undefined => cache.days[date];
export const dayError = (date: string) => errors[dayRow(date)];

/** A screen shows `date`: load it (the local copy shows meanwhile) and keep it fresh on resume. */
export function watchDay(date: string): () => void {
  // The first screen to open means the app has started (config loaded, Member known): send
  // whatever an earlier session left queued.
  if (!started) {
    started = true;
    void outbox.flush();
  }
  watched.set(date, (watched.get(date) ?? 0) + 1);
  void loadDay(date);
  return () => {
    const n = (watched.get(date) ?? 1) - 1;
    if (n > 0) watched.set(date, n);
    else watched.delete(date);
  };
}

/** Save the whole Day on the device now and queue it for the API. */
export function saveDay(day: Day) {
  const row = dayRow(day.date);
  bump(row);
  // The first change since the server's copy: remember that copy, to merge against if needed.
  const prev = cache.pending?.[day.date];
  const base = prev ? prev.base : cache.offlineStarted?.includes(day.date) ? null : (cache.days[day.date] ?? null);
  cache.pending = { ...cache.pending, [day.date]: { base, merge: !!prev?.merge || !fresh.has(day.date) } };
  cache.days = { ...cache.days, [day.date]: day };
  errors = { ...errors, [row]: undefined };
  writeCache();
  emit();
  void outbox.enqueue({ type: "putDay", day });
}

/**
 * One Day that may not be on screen (e.g. the Day an Entry moves to): this device's copy if a
 * write to it is still queued, else the server's, else (offline) the copy kept here or an empty Day.
 */
export async function readDay(date: string): Promise<Day> {
  if (outbox.pendingFor(dayRow(date))) return cache.days[date];
  try {
    const [server] = await getDays(date, date);
    if (outbox.pendingFor(dayRow(date))) return cache.days[date];
    const day = server ?? emptyDay(date);
    cache.days = { ...cache.days, [date]: day };
    settled(date);
    writeCache();
    return day;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    wentOffline();
    if (cache.days[date]) return cache.days[date];
    cache.offlineStarted = [...(cache.offlineStarted ?? []), date];
    return emptyDay(date);
  }
}

/**
 * Days from `from` to `to` (inclusive) for Week and Trends: the server's, with this device's copy
 * of any Day still waiting in the outbox laid over them. Offline, the Days kept on the device.
 */
export async function loadDays(from: string, to: string): Promise<Record<string, Day>> {
  const inRange = (d: string) => d >= from && d <= to;
  try {
    const byDate = daysByDate(await getDays(from, to));
    for (const op of outbox.pending()) if (op.type === "putDay" && inRange(op.day.date)) byDate[op.day.date] = op.day;
    return byDate;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    return Object.fromEntries(Object.entries(cache.days).filter(([d]) => inRange(d)));
  }
}

// ---- Goals -----------------------------------------------------------------

export const currentGoals = () => cache.goals;
export const goalsError = () => errors[GOALS_ROW];

export function watchGoals() {
  if (goalsWatched) return;
  goalsWatched = true;
  void loadGoals();
}

/**
 * Save goals on the device and queue them. Resolves once they reached the API or are waiting for
 * a connection; throws if the API refused them (the screen shows the message).
 */
export async function saveGoals(goals: Goals): Promise<void> {
  bump(GOALS_ROW);
  cache.goals = goals;
  errors = { ...errors, [GOALS_ROW]: undefined };
  writeCache();
  emit();
  await outbox.enqueue({ type: "putGoals", goals });
  const refused = errors[GOALS_ROW];
  if (refused) throw new Error(refused);
}

// ---- Meal windows --------------------------------------------------------------

/** The Member's Meal windows (undefined until first loaded; Today guesses with the defaults meanwhile). */
export const currentMealWindows = () => cache.mealWindows;
export const mealWindowsError = () => errors[WINDOWS_ROW];

export function watchMealWindows() {
  if (windowsWatched) return;
  windowsWatched = true;
  void loadMealWindows();
}

/** Save Meal windows on the device and queue them; throws if the API refused them (like saveGoals). */
export async function saveMealWindows(windows: MealWindows): Promise<void> {
  bump(WINDOWS_ROW);
  cache.mealWindows = windows;
  errors = { ...errors, [WINDOWS_ROW]: undefined };
  writeCache();
  emit();
  await outbox.enqueue({ type: "putMealWindows", windows });
  const refused = errors[WINDOWS_ROW];
  if (refused) throw new Error(refused);
}

// ---- Favorites ---------------------------------------------------------------

/** The Member's Favorites (undefined until first loaded). Quick Add order is `quickAdd` in shared. */
export const currentFavorites = () => cache.favorites;
export const favoritesError = () => errors[FAVS_ROW];

/** A screen shows Favorites (star buttons, Quick Add): load them once, and again on resume. */
export function watchFavorites() {
  if (favoritesWatched) return;
  favoritesWatched = true;
  void loadFavorites();
}

function saveFavorites(next: Favorite[]) {
  bump(FAVS_ROW);
  cache.favorites = next;
  errors = { ...errors, [FAVS_ROW]: undefined };
  writeCache();
  emit();
}

/** Star or unstar a Library item, on the device now and queued for the API. */
export function toggleFavorite(libraryId: string) {
  const { favorites, change } = toggled(cache.favorites ?? [], libraryId, Date.now());
  saveFavorites(favorites);
  void outbox.enqueue(change.type === "put" ? { type: "putFavorite", favorite: change.favorite } : { type: "deleteFavorite", libraryId });
}

/**
 * Entries were just logged from these Library items (from Quick Add, search or anywhere else):
 * every starred one moves to the top of Quick Add. Unstarred items change nothing.
 */
export function noteLogged(libraryIds: readonly (string | null | undefined)[]) {
  const { favorites, bumped } = bumpFavorites(cache.favorites ?? [], libraryIds, Date.now());
  if (!bumped.length) return;
  saveFavorites(favorites);
  for (const favorite of bumped) void outbox.enqueue({ type: "putFavorite", favorite });
}

/**
 * Drop a Library item from this device's Favorites without a write (Library delete, ticket 15:
 * the server already removes everyone's Favorites of a deleted item).
 */
export function forgetFavorite(libraryId: string) {
  if (!cache.favorites?.some((f) => f.libraryId === libraryId)) return;
  cache.favorites = cache.favorites.filter((f) => f.libraryId !== libraryId);
  writeCache();
  emit();
}
