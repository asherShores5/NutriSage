// What's typed in a number box (nutrition, goals, gram weights, Prepared weight, Yield ratio):
// blank, or a number 0 or more. Callers add their own limits and messages.

/** A typed number: blank gives `blank`; else a finite number 0 or more (a comma works as the decimal point); undefined otherwise. */
export function readNumberBox<B extends number | null>(text: string, blank: B): number | B | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return blank;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}
