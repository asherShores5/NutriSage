import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";

const GOOD = "Correct horse 42 staple";

describe("passwordProblem", () => {
  it("accepts a password the pool would take", () => {
    expect(passwordProblem(GOOD, GOOD, "old")).toBeUndefined();
  });
  it("names the first rule a password breaks", () => {
    expect(passwordProblem("Short1a", "Short1a", "old")).toBe("Use at least 16 characters.");
    expect(passwordProblem("ALL CAPS AND 12345", "x", "old")).toBe("Add a lowercase letter.");
    expect(passwordProblem("all lower and 12345", "x", "old")).toBe("Add an uppercase letter.");
    expect(passwordProblem("No digits in here at all", "x", "old")).toBe("Add a number.");
  });
  it("refuses the current password and a mismatched confirmation", () => {
    expect(passwordProblem(GOOD, GOOD, GOOD)).toBe("Pick a password different from your current one.");
    expect(passwordProblem(GOOD, GOOD + "!", "old")).toBe("The two new passwords don't match.");
  });
});
