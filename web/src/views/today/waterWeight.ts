// Water cups and the once-per-Day weight box, kept pure so they're testable without a DOM.
import { DAY_WEIGHT_MAX } from "./limits";

/** Tap cup `index` (0-based): fill up to it, or take one off when it's the top filled cup. */
export function cupsAfterTap(cups: number, index: number): number {
  return index + 1 === cups ? index : index + 1;
}

/** How many cups to draw: the goal's worth, plus any logged over it (at least one). */
export function cupsShown(cups: number, goal: number): number {
  return Math.max(1, goal, cups);
}

export type WeightResult = { ok: true; weight: number } | { ok: false; error: string };

export function readWeight(text: string): WeightResult {
  const t = text.trim();
  const w = t === "" ? NaN : Number(t);
  if (!Number.isFinite(w) || w < 0.1 || w > DAY_WEIGHT_MAX) return { ok: false, error: `Weight must be a number from 0.1 to ${DAY_WEIGHT_MAX}` };
  return { ok: true, weight: w };
}
