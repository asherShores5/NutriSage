// Which Meal the add box starts on (spec: Meal windows). The guess comes from the Member's Meal
// windows at app open and again when the local date rolls over; a Meal the Member picks sticks
// until the app is reopened (or the date rolls over: a new Day starts from a fresh guess).
import { dateKey, guessMeal, type Meal, type MealWindows } from "@nutrisage/shared";

export function mealPickSession(openedAt: Date) {
  let guessedAt = openedAt;
  let picked: Meal | undefined;
  return {
    /** The Meal to show at `now` with these windows (the Member's, or the defaults until they load). */
    current(windows: MealWindows, now: Date): Meal {
      if (dateKey(now) !== dateKey(guessedAt)) {
        guessedAt = now;
        picked = undefined;
      }
      return picked ?? guessMeal(windows, guessedAt);
    },
    /** The Member chose a Meal themselves. */
    pick(meal: Meal) {
      picked = meal;
    },
  };
}
