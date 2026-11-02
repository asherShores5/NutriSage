// Ticket 16: the redirect page that will replace the old GitHub Pages site (docs/cutover-runbook.md).
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "..", "..", "cutover", "pages-redirect");
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");

describe("old Pages redirect page", () => {
  it("is the same page at the old root, the old app's docs/ path and every other old path (404)", () => {
    expect(read("docs/index.html")).toBe(read("index.html"));
    expect(read("404.html")).toBe(read("index.html"));
  });

  it("sends people to the new domain and nowhere else", () => {
    const html = read("index.html");
    expect(html).toContain('location.replace("https://nutrisage.ashershores.com/")');
    expect(html).toContain('http-equiv="refresh" content="3; url=https://nutrisage.ashershores.com/"');
    const origins = new Set([...html.matchAll(/https?:\/\/[^/"'\s]+/g)].map((m) => m[0]));
    expect([...origins]).toEqual(["https://nutrisage.ashershores.com"]);
  });
});
