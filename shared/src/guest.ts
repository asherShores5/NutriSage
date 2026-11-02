// A Guest's demo data (spec: Guest access): seeded into browser storage on first open so the app
// isn't empty. Ported from the old app's seedGuestDataIfEmpty (same menu and pattern).
import type { Day, Meal } from "./day";
import { foodFromServing, type Food } from "./food";
import type { Goals } from "./goals";
import type { Nutrition } from "./nutrients";

/** One demo menu item: one serving's nutrition and weight, and the Meal the demo Days log it in. */
interface MenuItem {
  id: string;
  name: string;
  nutrition: Nutrition;
  servingGrams: number;
  meal: Meal;
}

/** Who a Guest's Foods are saved by (a Guest has no username). */
export const GUEST_CREATOR = "guest";

const food = (id: string, name: string, meal: Meal, servingGrams: number, [carbs, protein, fat, fiber, sodium, iron, calories]: number[]): MenuItem => ({
  id, name, meal, servingGrams, nutrition: { carbs, protein, fat, fiber, sodium, iron, calories },
});

const MENU: MenuItem[] = [
  food("demo-eggs", "2 eggs and toast", "breakfast", 150, [30, 18, 14, 3, 380, 2.5, 330]),
  food("demo-yogurt", "Greek yogurt with berries", "breakfast", 200, [22, 15, 4, 3, 65, 0.4, 190]),
  food("demo-salad", "Grilled chicken salad", "lunch", 350, [18, 38, 16, 6, 620, 2.1, 380]),
  food("demo-sandwich", "Turkey sandwich", "lunch", 250, [42, 28, 12, 5, 890, 3.0, 400]),
  food("demo-salmon", "Salmon with rice and broccoli", "dinner", 400, [45, 34, 18, 6, 470, 1.8, 500]),
  food("demo-spaghetti", "Spaghetti with meat sauce", "dinner", 450, [62, 26, 20, 7, 720, 4.2, 560]),
  food("demo-apple", "Apple", "snack", 182, [25, 0, 0, 4, 2, 0.2, 95]),
  food("demo-almonds", "Handful of almonds", "snack", 28, [6, 6, 14, 3, 0, 1.1, 165]),
];

/** The date `n` days before `date` (YYYY-MM-DD), by calendar. */
function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

export interface GuestSeed {
  /** Oldest first. */
  days: Day[];
  /** The demo Library: the menu as Foods per gram, with the menu ids. */
  library: Food[];
  goals: Goals;
}

const DEMO_GOALS: Goals = { carbs: 220, protein: 130, fat: 70, fiber: 30, sodium: 2300, iron: 18, calories: 2000, water: 8 };

/**
 * Demo Days for the 10 days ending `today` (YYYY-MM-DD), skipping every fourth so streaks and
 * gaps show, each with three Entries, water and a weight; plus the demo Library and goals.
 */
export function guestSeed(today: string): GuestSeed {
  const days: Day[] = [];
  for (let i = 9; i >= 0; i--) {
    if (i % 4 === 3) continue;
    const date = daysBefore(today, i);
    const entries = [i % 8, (i + 2) % 8, (i + 5) % 8].map((m, n) => {
      const f = MENU[m];
      return { id: `${f.id}-${date}-${n}`, meal: f.meal, name: f.name, nutrition: { ...f.nutrition }, amount: 1, unit: "serving", grams: f.servingGrams, libraryId: f.id };
    });
    days.push({ date, entries, water: 4 + (i % 5), weight: Math.round((165 - i * 0.2) * 10) / 10 });
  }
  const library = MENU.map((f): Food => ({ id: f.id, ...foodFromServing(f), createdBy: GUEST_CREATOR, updatedAt: 0 }));
  return { days, library, goals: { ...DEMO_GOALS } };
}
