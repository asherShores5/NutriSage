// A Guest's data, in this browser's storage only (spec: Guest access). Nothing here talks to a
// server. Shape: { days: { [date]: Day }, library: Food[], goals: Goals }.
import {
  GUEST_CREATOR, NUTRIENT_KEYS, defaultGoals, editedFood, findFoodByName, foodFromServing, foodNameKey, guestSeed,
  type Day, type Food, type FoodEdit, type Goals, type ServingInput,
} from "@nutrisage/shared";

const KEY = "nutrisage.guest.data";

interface GuestData {
  days: Record<string, Day>;
  library: Food[];
  goals: Goals;
}

/** A stored Library item as a Food. Devices seeded before ticket 12 hold one serving's nutrition and no units. */
function asFood(f: any): Food {
  if (Array.isArray(f?.units)) return f as Food;
  return { id: String(f?.id), ...foodFromServing({ name: String(f?.name ?? ""), nutrition: f?.nutrition ?? {}, servingGrams: null }), createdBy: GUEST_CREATOR, updatedAt: 0 };
}

function read(): GuestData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (d && typeof d === "object") return { days: d.days ?? {}, library: (Array.isArray(d.library) ? d.library : []).map(asFood), goals: { ...defaultGoals(), ...d.goals } };
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

/** The Guest's own Library: the demo Foods plus what they estimated. The household Library is never shown to a Guest. */
export function guestLibrary(): Food[] {
  return read().library;
}

/**
 * Save an estimate to the Guest's device Library, like the Member estimate does on the server:
 * an existing Food with the same name (ignoring case) is returned instead; all-zero estimates aren't saved.
 */
export function addGuestFood(est: ServingInput): Food | null {
  if (NUTRIENT_KEYS.every((k) => !Number(est.nutrition[k]))) return null;
  const data = read();
  const existing = findFoodByName(data.library, est.name);
  if (existing) return existing;
  const food: Food = { id: crypto.randomUUID(), ...foodFromServing(est), createdBy: GUEST_CREATOR, updatedAt: Date.now() };
  data.library.push(food);
  write(data);
  return food;
}

/** Edit a Food in the Guest's device Library, like the Member `putFood` (same checks, same words). */
export function putGuestFood(id: string, edit: FoodEdit): Food {
  const r = editedFood(edit);
  if (!r.ok) throw new Error(r.error);
  const data = read();
  const existing = data.library.find((f) => f.id === id);
  if (!existing) throw new Error("That Food is no longer in the Library");
  const clash = data.library.find((f) => f.id !== id && foodNameKey(f.name) === foodNameKey(r.food.name));
  if (clash) throw new Error(`The Library already has ${clash.name}`);
  const food: Food = { id, ...r.food, createdBy: existing.createdBy, updatedAt: Date.now() };
  data.library = data.library.map((f) => (f.id === id ? food : f));
  write(data);
  return food;
}

/** Delete a Food from the Guest's device Library, like the Member `deleteFood`. Days are untouched. */
export function deleteGuestFood(id: string): string {
  const data = read();
  data.library = data.library.filter((f) => f.id !== id);
  write(data);
  return id;
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
