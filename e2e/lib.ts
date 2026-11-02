// Shared helpers for the check scripts.
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { calls } from "./backend";

/** Screenshots go to /tmp/e2e-nutrisage-<checkout folder>, so parallel worktrees don't overwrite each other. */
export const OUT = process.env.E2E_OUT ?? `/tmp/e2e-nutrisage-${path.basename(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))}`;
mkdirSync(OUT, { recursive: true });

/** A checklist: run named checks, screenshot failures, print PASS/FAIL at the end. */
export function checklist(prefix: string) {
  const results: [string, boolean, string][] = [];
  let page: Page | undefined;
  return {
    /** The page to screenshot when a check fails. */
    watch: (p: Page) => void (page = p),
    async check(name: string, fn: () => Promise<string | void>) {
      try {
        results.push([name, true, (await fn()) ?? ""]);
      } catch (e) {
        results.push([name, false, (e as Error).message.split("\n")[0]]);
        if (page) await shot(page, `${prefix}-FAIL-${results.length}`).catch(() => {});
      }
    },
    /** Print results; exits non-zero if any check failed. */
    report() {
      for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `\n      ${d}` : ""}`);
      const failed = results.filter((r) => !r[1]).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      if (failed) process.exitCode = 1;
      return failed;
    },
  };
}

export const shot = (p: Page, n: string) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
export const lastCall = (field: string) => [...calls].reverse().find((c) => c.field === field);

/** Switch bottom tab. */
export async function tab(p: Page, name: string) {
  await p.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name, exact: true }).click();
}
