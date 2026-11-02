// A Guest's data, in this browser's storage only (spec: Guest access). Nothing here talks to a
// server. Shape: { days: { [date]: Day }, library: GuestFood[], goals: Goals }.
import { defaultGoals, guestSeed, type Day, type Goals, type GuestFood } from "@nutrisage/shared";

const KEY = "nutrisage.guest.data";

interface GuestData {
  days: Record<string, Day>;
  library: GuestFood[];
  goals: Goals;
}

function read(): GuestData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (d && typeof d === "object") return { days: d.days ?? {}, library: d.library ?? [], goals: { ...defaultGoals(), ...d.goals } };
  } catch {
    // unreadable: start over
  }
  return { days: {}, library: [], goals: defaultGoals() };
}

const write = (d: GuestData) => localStorage.setItem(KEY, JSON.stringify(d));

/** Seed demo Days and the demo Library unless this device already has Guest data. */
export function seedGuestData(today: string) {
  if (localStorage.getItem(KEY)) return;
  const seed = guestSeed(today);
  write({ days: Object.fromEntries(seed.days.map((d) => [d.date, d])), library: seed.library, goals: seed.goals });
}

export function clearGuestData() {
  localStorage.removeItem(KEY);
}

/** The Guest's Days from `from` to `to` (inclusive), oldest first; like the Member `days` query. */
export function guestDays(from: string, to: string): Day[] {
  return Object.values(read().days)
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Save the whole Day (last write wins), like the Member `putDay`. */
export function putGuestDay(day: Day): Day {
  const data = read();
  const saved = { ...day, updatedAt: Date.now() };
  data.days[day.date] = saved;
  write(data);
  return saved;
}

/** The demo Library (for the Library screens, M2). The household Library is never shown to a Guest. */
export function guestLibrary(): GuestFood[] {
  return read().library;
}

/** The Guest's goals, like the Member `goals` query. */
export function guestGoals(): Goals {
  return read().goals;
}

/** Replace the Guest's goals, like the Member `putGoals`. */
export function putGuestGoals(goals: Goals): Goals {
  const data = read();
  data.goals = { ...goals };
  write(data);
  return data.goals;
}
