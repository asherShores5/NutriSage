// The Member's data on this device: a local copy of the Days and goals the screens have opened,
// saved in localStorage, plus the outbox that writes them through to the API (HoneyDo-style:
// local copy first, server is the sync layer). Screens read and write through useDay/useGoals;
// nothing here renders.
//
// - A change shows at once and is saved on the device before it is sent, so logging works offline
//   and survives closing the app. The outbox sends writes in order when the API answers again.
// - Opening the app, coming back to it (visible or focused) and going back online first send the
//   outbox, then reload every open Day and the goals, so changes from other devices show up.
// - Every write carries the whole row: last write wins per Day. A row with a queued write keeps
//   the local copy over the server's until that write lands.
// - Only a signed-in Member's copy is saved; it's dropped when a different Member (or nobody)
//   signs in on this device.
import type { Day, Goals } from "@nutrisage/shared";
import { getDays, putDay } from "../api/days";
import { NetworkError } from "../api/errors";
import { getGoals, putGoals } from "../api/goals";
import { currentUsername, onAuthChange } from "../auth";
import { createOutbox, opRow, type Op } from "./outbox";

const CACHE = "nutrisage.cache.v1";
const OUTBOX = "nutrisage.outbox.v1";
/** Days kept on the device (newest first); older ones reload from the API when opened. */
const KEEP_DAYS = 62;
/** After a failed send, try again this often while writes are waiting (the "online" event alone misses weak signal). */
const RETRY_MS = 20_000;

interface Cache {
  user?: string;
  days: Record<string, Day>;
  goals?: Goals;
}

const dayRow = (date: string) => `DAY#${date}`;
const GOALS_ROW = "GOALS";
const emptyDay = (date: string): Day => ({ date, entries: [], water: null, weight: null });

let user = currentUsername();
let cache: Cache = readCache(user);
/** Load or write errors per row, shown by the screen that row belongs to. */
let errors: Record<string, string | undefined> = {};
/** Bumped on every local change to a row, so a slower load can't land over a newer local edit. */
const edits = new Map<string, number>();
/** Dates open on some screen (ref-counted), reloaded on resume. */
const watched = new Map<string, number>();
let goalsWatched = false;
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
  const c = u ? readJSON<Cache>(CACHE) : undefined;
  return c && c.user === u ? { user: u, days: c.days ?? {}, goals: c.goals } : { user: u, days: {} };
}

function readOps(u: string | undefined): Op[] {
  const o = u ? readJSON<{ user?: string; ops?: Op[] }>(OUTBOX) : undefined;
  return o && o.user === u ? (o.ops ?? []) : [];
}

function writeCache() {
  if (!user) return;
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
      if (u) localStorage.setItem(OUTBOX, JSON.stringify({ user: u, ops }));
    },
    send: (op) => (op.type === "putDay" ? putDay(op.day) : putGoals(op.goals)),
    onSent: (op, result, stillPending) => {
      if (stillPending) return;
      if (op.type === "putDay") cache.days = { ...cache.days, [op.day.date]: result as Day };
      else cache.goals = result as Goals;
      writeCache();
      emit();
    },
    onRejected: (op, e) => {
      errors = { ...errors, [opRow(op)]: `Couldn't save: ${e.message}` };
      // Show what the server actually holds instead of the refused change.
      if (op.type === "putDay") void loadDay(op.day.date, true);
      else void loadGoals(true);
      emit();
    },
    onReachable: (reachable) => {
      if (reachable) return;
      clearTimeout(retry);
      retry = setTimeout(() => void outbox.flush(), RETRY_MS);
    },
  });
}

let outbox = newOutbox(user);

// Another Member signed in (or out) on this device: drop the last one's copy and queued writes.
onAuthChange(() => {
  const next = currentUsername();
  if (next === user) return;
  if (!next) {
    localStorage.removeItem(CACHE);
    localStorage.removeItem(OUTBOX);
  }
  user = next;
  cache = readCache(user);
  errors = {};
  edits.clear();
  outbox = newOutbox(user);
  emit();
  resume();
});

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
    writeCache();
    if (!keepError) errors = { ...errors, [row]: undefined };
  } catch (e) {
    if (e instanceof NetworkError) {
      // Offline with nothing on the device yet: start the Day empty so logging still works.
      if (!cache.days[date]) cache.days = { ...cache.days, [date]: emptyDay(date) };
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

let resuming: Promise<void> | undefined;

/** Send the outbox, then reload every open Day and the goals. One at a time. */
export function resume(): Promise<void> {
  resuming ??= (async () => {
    if (!user) return;
    await outbox.flush();
    await Promise.all([...[...watched.keys()].map((d) => loadDay(d)), goalsWatched ? loadGoals() : undefined]);
  })().finally(() => (resuming = undefined));
  return resuming;
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void resume());
  window.addEventListener("focus", () => void resume());
  window.addEventListener("online", () => void resume());
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
  cache.days = { ...cache.days, [day.date]: day };
  errors = { ...errors, [row]: undefined };
  writeCache();
  emit();
  void outbox.enqueue({ type: "putDay", day });
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
