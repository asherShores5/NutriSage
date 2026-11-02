import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_WINDOWS } from "@nutrisage/shared";
import { mealPickSession } from "./mealPick";

const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 10, day, h, m);
};

describe("the Meal picker's session", () => {
  it("starts on the Meal guessed from the windows at app open", () => {
    const s = mealPickSession(at(2, "12:00"));
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(2, "12:00"))).toBe("lunch");
  });

  it("keeps the open-time guess during the Day (the guess runs on open, not every minute)", () => {
    const s = mealPickSession(at(2, "10:00"));
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(2, "15:00"))).toBe("breakfast");
  });

  it("uses the Member's windows once they load", () => {
    const s = mealPickSession(at(2, "10:00"));
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(2, "10:00"))).toBe("breakfast");
    expect(s.current({ ...DEFAULT_MEAL_WINDOWS, lunch: "09:30" }, at(2, "10:01"))).toBe("lunch");
  });

  it("a Meal I pick sticks for the rest of the session", () => {
    const s = mealPickSession(at(2, "10:00"));
    s.pick("dessert");
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(2, "10:05"))).toBe("dessert");
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(2, "23:00"))).toBe("dessert");
  });

  it("when the date rolls over, guesses again from the new time and drops my pick", () => {
    const s = mealPickSession(at(2, "21:00"));
    s.pick("snack");
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(3, "07:00"))).toBe("breakfast");
    expect(s.current(DEFAULT_MEAL_WINDOWS, at(3, "12:00"))).toBe("breakfast");
  });
});
