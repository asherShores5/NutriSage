// Progress bar logic for Today and Week (spec: "Kept as-is"). Ported from the old docs/macros.js
// (barState, energyBalance) at GitHub main 13e8f12, plus the row layout the old renderBarGroups drew.
import { NUTRIENTS, num, pct, type NutrientKey } from "./nutrients";

/** '' = under target (or no goal), 'good' = on target, 'over' = a real overage, 'spill' = carbs/fat swap. */
export type BarStateName = "" | "good" | "over" | "spill";

/** More is fine for these: green from 90% of goal up, never "over". */
export const MORE_IS_GOOD: ReadonlySet<NutrientKey> = new Set(["protein", "fiber"]);

/** One nutrient against its own goal: green within ±10% (or at/over for protein, fiber), red past 110%. */
export function barState(key: NutrientKey, value: unknown, goal: unknown): BarStateName {
  const g = num(goal);
  if (g <= 0) return "";
  const v = num(value);
  if (MORE_IS_GOOD.has(key)) return v >= g * 0.9 ? "good" : "";
  if (v >= g * 0.9 && v <= g * 1.1) return "good";
  if (v > g * 1.1) return "over";
  return "";
}

/** Calories per gram of the two interchangeable energy nutrients. */
export const CAL_PER_G = { carbs: 4, fat: 9 } as const;
type PoolKey = keyof typeof CAL_PER_G;

export interface PoolState {
  state: BarStateName;
  /** Calories this nutrient borrowed from its partner (only when 'spill'). */
  spillCal: number;
  partner: PoolKey;
}

/**
 * Carbs and fat judged as one caloric pool: being over one while under the other by the same
 * calories is a swap ('spill'), not an overage. 'over' only when the combined pool is >10% over.
 * With either goal unset, each falls back to its own barState.
 */
export function energyBalance(
  totals: Partial<Record<PoolKey, unknown>> | null | undefined,
  goals: Partial<Record<PoolKey, unknown>> | null | undefined,
): Record<PoolKey, PoolState> {
  const cGoal = num(goals?.carbs), fGoal = num(goals?.fat);
  const cVal = num(totals?.carbs), fVal = num(totals?.fat);
  const out: Record<PoolKey, PoolState> = {
    carbs: { state: barState("carbs", cVal, cGoal), spillCal: 0, partner: "fat" },
    fat: { state: barState("fat", fVal, fGoal), spillCal: 0, partner: "carbs" },
  };
  if (cGoal <= 0 || fGoal <= 0) return out;

  const poolGoal = cGoal * CAL_PER_G.carbs + fGoal * CAL_PER_G.fat;
  const poolVal = cVal * CAL_PER_G.carbs + fVal * CAL_PER_G.fat;
  const poolOver = poolVal > poolGoal * 1.1;
  const poolGood = poolVal >= poolGoal * 0.9 && poolVal <= poolGoal * 1.1;

  for (const [key, val, goal] of [["carbs", cVal, cGoal], ["fat", fVal, fGoal]] as const) {
    const overGrams = val - goal;
    if (overGrams > goal * 0.1) {
      if (poolOver) out[key].state = "over";
      else out[key] = { ...out[key], state: "spill", spillCal: Math.round(overGrams * CAL_PER_G[key]) };
    } else if (poolGood) {
      out[key].state = "good";
    }
  }
  return out;
}

export interface BarRow {
  key: NutrientKey;
  label: string;
  unit: string;
  value: number;
  /** 0 = no goal set. */
  goal: number;
  pct: number;
  state: BarStateName;
  /** Caption under the bar, e.g. "⇄ 180 cal swapped with carbs"; '' for none. */
  note: string;
}

export interface BarGroup {
  label: "Macros" | "Micronutrients";
  rows: BarRow[];
}

/** Bar order, as the old app drew it: fiber sits with the Macros. */
const GROUPS: [BarGroup["label"], NutrientKey[]][] = [
  ["Macros", ["carbs", "protein", "fat", "fiber", "calories"]],
  ["Micronutrients", ["sodium", "iron"]],
];

/**
 * The Macro and Micronutrient bars for some totals against some goals (Today: a Day's totals vs
 * goals; Week: averages vs goals, or totals vs goals x7). Carbs and fat use the shared energy pool.
 */
export function barGroups(
  totals: Partial<Record<NutrientKey, unknown>> | null | undefined,
  goals: Partial<Record<NutrientKey, unknown>> | null | undefined,
): BarGroup[] {
  const energy = energyBalance(totals, goals);
  return GROUPS.map(([label, keys]) => ({
    label,
    rows: keys.map((key) => {
      const n = NUTRIENTS.find((x) => x.key === key)!;
      const value = num(totals?.[key]);
      const goal = Math.max(0, num(goals?.[key]));
      const pool = key === "carbs" || key === "fat" ? energy[key] : undefined;
      return {
        key, label: n.label, unit: n.unit, value, goal, pct: pct(value, goal),
        state: pool ? pool.state : barState(key, value, goal),
        note: pool?.spillCal ? `⇄ ${pool.spillCal} cal swapped with ${pool.partner}` : "",
      };
    }),
  }));
}
