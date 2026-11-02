// A Member's daily goals (spec: Goals). One target per tracked nutrient plus cups of water.
// A goal of 0 means "no goal": its bar shows the amount with no target. Meal windows (ticket 07)
// are stored alongside but are their own type.
import { NUTRIENT_KEYS, type Nutrition } from "./nutrients";

export interface Goals extends Nutrition {
  /** Cups of water per Day. */
  water: number;
}

/** The old app's water goal default. */
export const DEFAULT_WATER_GOAL = 8;

/** Goals before a Member sets any: no nutrient goals, 8 cups of water. */
export function defaultGoals(): Goals {
  return { ...(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Nutrition), water: DEFAULT_WATER_GOAL };
}
