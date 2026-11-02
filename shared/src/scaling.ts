// Unit and gram scaling (spec: Domain model > Entry, Testing > unit and per-gram scaling). An
// Entry's nutrition is a snapshot for its amount and unit; changing either rescales the snapshot.
// Units convert through gram weights, so switching serving <-> g needs a known gram weight.
import { amountMax, isAmount } from "./amount";
import type { Entry } from "./day";
import { NUTRIENT_KEYS, num, type Nutrition } from "./nutrients";

export const SERVING = "serving";
export const GRAMS = "g";

/** A unit to log in, with the gram weight of one of it when known. */
export interface Unit {
  label: string;
  grams: number | null;
}

/** An amount of a unit, e.g. 1 1/2 serving or 350 g. */
export interface Amount {
  amount: number;
  unit: string;
}

/** Nutrition (and gram weight, when known) for some amount. */
export interface Snapshot {
  nutrition: Nutrition;
  grams?: number | null;
}

export type ScaleResult = { ok: true; nutrition: Nutrition; grams: number | null } | { ok: false; error: string };

const article = (unit: string) => (unit === SERVING ? "a serving" : unit);

/** Units for one serving of a Food: serving, plus g when the serving's gram weight is known. */
export function servingUnits(servingGrams: number | null | undefined): Unit[] {
  return servingGrams ? [{ label: SERVING, grams: servingGrams }, { label: GRAMS, grams: 1 }] : [{ label: SERVING, grams: null }];
}

/** Rescale `snap`, which is for `from`, to `to`. Unit changes go through the units' gram weights. */
export function scaleSnapshot(snap: Snapshot, from: Amount, to: Amount, units: readonly Unit[]): ScaleResult {
  if (!isAmount(to.amount, to.unit)) {
    return { ok: false, error: to.amount > amountMax(to.unit) ? `Amount must be at most ${amountMax(to.unit)}${to.unit === GRAMS ? " g" : ""}` : "Amount must be more than 0" };
  }
  let factor: number;
  if (from.unit === to.unit) factor = to.amount / from.amount;
  else {
    const gramsOf = (label: string) => units.find((u) => u.label === label)?.grams ?? null;
    const [g1, g2] = [gramsOf(from.unit), gramsOf(to.unit)];
    if (!g1 || !g2) {
      return { ok: false, error: `No gram weight is known for ${article(g1 ? to.unit : from.unit)}, so it can't be logged in ${g1 ? from.unit : to.unit}` };
    }
    factor = (to.amount * g2) / (from.amount * g1);
  }
  const nutrition = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, num(snap.nutrition[k]) * factor])) as Nutrition;
  return { ok: true, nutrition, grams: snap.grams ? snap.grams * factor : null };
}

/** An Entry's amount and unit; a migrated Entry (none stored) is 1 serving of its snapshot. */
export function entryAmount(e: Pick<Entry, "amount" | "unit">): Amount {
  return { amount: e.amount && e.amount > 0 ? e.amount : 1, unit: e.unit || SERVING };
}

/** The units an Entry can be rescaled into: its own, plus g when its gram weight is known. */
export function entryUnits(e: Pick<Entry, "amount" | "unit" | "grams">): Unit[] {
  const { amount, unit } = entryAmount(e);
  if (unit === GRAMS) return [{ label: GRAMS, grams: 1 }];
  return e.grams ? [{ label: unit, grams: e.grams / amount }, { label: GRAMS, grams: 1 }] : [{ label: unit, grams: null }];
}

export type RescaleResult = { ok: true; entry: Entry } | { ok: false; error: string };

/** The Entry with a new amount and/or unit and its snapshot (and grams) rescaled to match. */
export function rescaleEntry(e: Entry, to: Amount, units: readonly Unit[]): RescaleResult {
  const r = scaleSnapshot(e, entryAmount(e), to, units);
  if (!r.ok) return r;
  const { grams: _drop, ...rest } = e;
  return { ok: true, entry: { ...rest, amount: to.amount, unit: to.unit, nutrition: r.nutrition, ...(r.grams ? { grams: r.grams } : {}) } };
}
