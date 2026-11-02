// The Library edit form's boxes (text) to a FoodEdit and back, kept pure so it's testable without
// a DOM. The rules on the numbers themselves are editedFood's (shared), which the API runs too.
import { NUTRIENTS, foodEdit, type Food, type FoodEdit, type NutrientKey } from "@nutrisage/shared";

export interface FoodFormValues {
  name: string;
  /** Per serving. */
  nutrition: Record<NutrientKey, string>;
  servingGrams: string;
  units: { label: string; grams: string }[];
  yieldRatio: string;
}

export type FoodFormResult = { ok: true; edit: FoodEdit } | { ok: false; error: string };

/** Up to 2 decimals, without trailing zeros. */
const show = (v: number) => String(Math.round(v * 100) / 100);

export function foodToForm(food: Food): FoodFormValues {
  const e = foodEdit(food);
  return {
    name: e.name,
    nutrition: Object.fromEntries(NUTRIENTS.map((n) => [n.key, show(e.nutrition[n.key])])) as FoodFormValues["nutrition"],
    servingGrams: e.servingGrams === null ? "" : show(e.servingGrams),
    units: e.units.map((u) => ({ label: u.label, grams: show(u.grams) })),
    yieldRatio: e.yieldRatio === null ? "" : String(e.yieldRatio),
  };
}

/** A box as a number, blank as `blank`, or NaN when it isn't a number. */
function read(text: string, blank: number | null): number | null {
  const t = text.trim();
  return t === "" ? blank : Number(t);
}
const bad = (v: number | null) => v !== null && !Number.isFinite(v);

export function readFoodForm(v: FoodFormValues): FoodFormResult {
  const nutrition = {} as FoodEdit["nutrition"];
  for (const n of NUTRIENTS) {
    const x = read(v.nutrition[n.key], 0);
    if (bad(x)) return { ok: false, error: `${n.label} must be a number` };
    nutrition[n.key] = x as number;
  }
  const servingGrams = read(v.servingGrams, null);
  if (bad(servingGrams)) return { ok: false, error: "Serving weight must be a number of grams" };
  const units: FoodEdit["units"] = [];
  for (const u of v.units) {
    const grams = read(u.grams, null);
    const name = u.label.trim() || "every unit";
    if (grams === null) return { ok: false, error: `Give ${name} a weight in grams` };
    if (bad(grams)) return { ok: false, error: `The weight of ${name} must be a number of grams` };
    units.push({ label: u.label, grams });
  }
  const yieldRatio = read(v.yieldRatio, null);
  if (bad(yieldRatio)) return { ok: false, error: "Yield ratio must be a number" };
  return { ok: true, edit: { name: v.name, nutrition, servingGrams, units, yieldRatio } };
}
