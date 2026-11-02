import { describe, expect, it } from "vitest";
import { oneTimePassword } from "../scripts/password";

describe("one-time Member password", () => {
  it("meets the user pool's policy: 16+ characters with upper, lower and a digit", () => {
    for (let i = 0; i < 200; i++) {
      const pw = oneTimePassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it("is easy to type on a phone: no look-alike characters, grouped in sixes", () => {
    const pw = oneTimePassword();
    expect(pw).not.toMatch(/[0O1lI]/);
    expect(pw).toMatch(/^[A-Za-z2-9]{6}(-[A-Za-z2-9]{6}){3}$/);
  });

  it("is different every time", () => {
    expect(new Set(Array.from({ length: 50 }, oneTimePassword)).size).toBe(50);
  });
});
