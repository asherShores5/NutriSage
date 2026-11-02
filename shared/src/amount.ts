// Amounts (spec: Domain model > Amount parsing): what a Member types next to the unit picker when
// logging or editing an Entry. Decimals, simple fractions and mixed numbers, more than 0 and at
// most 100 (5000 when the unit is grams, so a weighed plate fits). Bad input gets a message.

/** Largest amount of any counted unit (serving, slice, cup...). */
export const AMOUNT_MAX = 100;
/** Largest amount in grams. */
export const AMOUNT_MAX_GRAMS = 5000;

export type AmountResult = { ok: true; amount: number } | { ok: false; error: string };

const DECIMAL = /^(\d+(?:\.\d*)?|\.\d+)$/;
const FRACTION = /^(?:(\d+) )?(\d+)\/(\d+)$/;
const HINT = "Type an amount like 0.4, 1/3 or 1 1/2";

/** The most of `unit` one Entry may hold. */
export const amountMax = (unit?: string | null) => (unit === "g" ? AMOUNT_MAX_GRAMS : AMOUNT_MAX);

/** Whether `amount` is a valid amount of `unit`: finite, more than 0, at most the unit's max. */
export const isAmount = (amount: unknown, unit?: string | null): amount is number =>
  typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount <= amountMax(unit);

/** Read a typed amount of `unit`: "0.4", "1/3", "1 1/2" (a comma works as the decimal point). */
export function parseAmount(text: string, unit?: string | null): AmountResult {
  const t = text.trim().replace(/\s+/g, " ").replace(",", ".");
  if (!t) return { ok: false, error: "Type an amount" };
  let amount: number;
  const f = FRACTION.exec(t);
  if (DECIMAL.test(t)) amount = Number(t);
  else if (f) {
    const [whole, top, bottom] = [Number(f[1] ?? 0), Number(f[2]), Number(f[3])];
    if (bottom === 0 || (f[1] !== undefined && top >= bottom)) return { ok: false, error: HINT };
    amount = whole + top / bottom;
  } else return { ok: false, error: HINT };
  if (!(amount > 0)) return { ok: false, error: "Amount must be more than 0" };
  const max = amountMax(unit);
  if (amount > max) return { ok: false, error: `Amount must be at most ${max}${unit === "g" ? " g" : ""}` };
  return { ok: true, amount };
}

/** An amount as a person would write it: "1 1/2", "1/3", "2", or a decimal to 2 places ("0.4"). */
export function formatAmount(amount: number): string {
  const whole = Math.floor(amount + 1e-9);
  const rest = amount - whole;
  if (Math.abs(rest) < 1e-9) return String(whole);
  for (const bottom of [2, 3, 4, 8]) {
    const top = Math.round(rest * bottom);
    if (top > 0 && top < bottom && Math.abs(rest - top / bottom) < 1e-6) {
      return `${whole ? `${whole} ` : ""}${top}/${bottom}`;
    }
  }
  return String(Math.round(amount * 100) / 100);
}
