import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "./amount";

describe("parseAmount (typing an amount)", () => {
  it("reads decimals, simple fractions and mixed numbers", () => {
    expect(parseAmount("0.4")).toEqual({ ok: true, amount: 0.4 });
    expect(parseAmount(" 2 ")).toEqual({ ok: true, amount: 2 });
    expect(parseAmount(".5")).toEqual({ ok: true, amount: 0.5 });
    expect(parseAmount("0,5")).toEqual({ ok: true, amount: 0.5 });
    expect(parseAmount("1/4")).toEqual({ ok: true, amount: 0.25 });
    expect(parseAmount("1 1/2")).toEqual({ ok: true, amount: 1.5 });
    expect(parseAmount("2  3/4")).toEqual({ ok: true, amount: 2.75 });
    expect(parseAmount("1/3")).toMatchObject({ ok: true });
    expect((parseAmount("1/3") as { amount: number }).amount).toBeCloseTo(0.3333, 4);
  });
});

describe("parseAmount rejects bad input with a message (never a silent reset to 1)", () => {
  const HINT = "Type an amount like 0.4, 1/3 or 1 1/2";

  it("asks for an amount when the box is empty", () => {
    expect(parseAmount("  ")).toEqual({ ok: false, error: "Type an amount" });
  });

  it("refuses text that isn't a number or fraction", () => {
    for (const t of ["abc", "1/", "/2", "1 1/2 3", "1.2.3", "-1", "1e3", "½", "1 / 2 /3", "Infinity"]) {
      expect(parseAmount(t), t).toEqual({ ok: false, error: HINT });
    }
  });

  it("refuses a zero denominator and an improper fraction inside a mixed number", () => {
    expect(parseAmount("1/0")).toEqual({ ok: false, error: HINT });
    expect(parseAmount("1 3/2")).toEqual({ ok: false, error: HINT });
  });

  it("accepts more than 0 and at most 100", () => {
    expect(parseAmount("100")).toEqual({ ok: true, amount: 100 });
    expect(parseAmount("0.01")).toEqual({ ok: true, amount: 0.01 });
    expect(parseAmount("0")).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(parseAmount("0/4")).toEqual({ ok: false, error: "Amount must be more than 0" });
    expect(parseAmount("100.5")).toEqual({ ok: false, error: "Amount must be at most 100" });
    expect(parseAmount("201/2")).toEqual({ ok: false, error: "Amount must be at most 100" });
  });

  it("allows up to 5000 when the unit is grams, so a weighed plate fits", () => {
    expect(parseAmount("350", "g")).toEqual({ ok: true, amount: 350 });
    expect(parseAmount("5000", "g")).toEqual({ ok: true, amount: 5000 });
    expect(parseAmount("5001", "g")).toEqual({ ok: false, error: "Amount must be at most 5000 g" });
    expect(parseAmount("101", "serving")).toEqual({ ok: false, error: "Amount must be at most 100" });
  });
});

describe("formatAmount (showing an amount back)", () => {
  it("writes halves, thirds, quarters and eighths as fractions, the rest as short decimals", () => {
    expect(formatAmount(2)).toBe("2");
    expect(formatAmount(1.5)).toBe("1 1/2");
    expect(formatAmount(1 / 3)).toBe("1/3");
    expect(formatAmount(2 / 3)).toBe("2/3");
    expect(formatAmount(0.25)).toBe("1/4");
    expect(formatAmount(2.75)).toBe("2 3/4");
    expect(formatAmount(0.125)).toBe("1/8");
    expect(formatAmount(0.4)).toBe("0.4");
    expect(formatAmount(122.456)).toBe("122.46");
  });

  it("round-trips through parseAmount", () => {
    for (const t of ["1 1/2", "1/3", "0.4", "7", "2 2/3"]) expect(formatAmount((parseAmount(t) as { amount: number }).amount)).toBe(t);
  });
});
