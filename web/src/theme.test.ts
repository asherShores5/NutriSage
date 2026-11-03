import { describe, expect, it } from "vitest";
import { readTheme } from "./theme";

describe("theme preference", () => {
  it("is light, dark or system; anything else (or nothing saved) is system", () => {
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("light")).toBe("light");
    expect(readTheme("system")).toBe("system");
    expect(readTheme(null)).toBe("system");
    expect(readTheme("purple")).toBe("system");
  });
});
