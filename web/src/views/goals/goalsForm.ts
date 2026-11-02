// The Goals form's rules, kept pure so they're testable without a DOM.
import { NUTRIENTS, type Goals } from "@nutrisage/shared";

export type GoalKey = keyof Goals;
export type GoalsFormValues = Record<GoalKey, string>;
export type GoalsFormResult = { ok: true; goals: Goals } | { ok: false; error: string };

/** Every target in form order, with its label and unit. */
export const GOAL_FIELDS: { key: GoalKey; label: string; unit: string }[] = [
  ...NUTRIENTS.map((n) => ({ key: n.key as GoalKey, label: n.label, unit: n.unit as string })),
  { key: "water", label: "Water", unit: "cups" },
];

/** What each box shows: the goal, or blank for no goal (0). */
export function goalsToForm(goals: Goals): GoalsFormValues {
  return Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, goals[f.key] ? String(goals[f.key]) : ""])) as GoalsFormValues;
}

export function readGoalsForm(values: GoalsFormValues): GoalsFormResult {
  const goals = {} as Goals;
  for (const f of GOAL_FIELDS) {
    const raw = values[f.key].trim();
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v) || v < 0) return { ok: false, error: `${f.label} goal must be a number, 0 or more` };
    if (f.key === "water" && !Number.isInteger(v)) return { ok: false, error: "Water goal must be a whole number of cups" };
    goals[f.key] = v;
  }
  return { ok: true, goals };
}
