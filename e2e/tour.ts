// Visual sweep: the sign-in screen and every tab on phone, desktop, and phone in dark theme.
// Screenshots in $OUT/tour-* (see lib.ts). Look at them; DOM checks miss layout bugs.
import type { Page } from "playwright";
import { launch, todayKey } from "./app";
import { graphql, seed } from "./backend";
import { lastDays } from "../shared/src/week";
import { OUT, shot, tab } from "./lib";

await seed(todayKey());
// A few past Days (gaps included) so Week and Trends have a streak and a line to show.
for (const [i, date] of lastDays(todayKey(), 21).slice(0, -1).entries()) {
  if (i % 5 === 3) continue;
  const calories = 1700 + ((i * 137) % 600);
  await graphql("fake-id.asher", "mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `h${i}`, meal: "dinner", name: "Past dinner", nutrition: { carbs: calories / 10, protein: 90, fat: 60, fiber: 25, sodium: 1800, iron: 9, calories } }], water: 6, weight: i % 3 ? null : 174 - i * 0.15 },
  });
}
const app = await launch();

const TABS = ["Today", "Week", "Trends", "Goals", "Profile"];

async function sweep(p: Page, name: string) {
  await p.getByRole("region", { name: "Entries" }).waitFor();
  for (const [i, t] of TABS.entries()) {
    await tab(p, t);
    await p.waitForTimeout(200);
    await shot(p, `tour-${name}-${String(i + 1).padStart(2, "0")}-${t.toLowerCase()}`);
  }
  // Today's form switched to typing nutrition by hand.
  await tab(p, "Today");
  await p.getByRole("button", { name: "Type nutrition by hand" }).click();
  await shot(p, `tour-${name}-01b-today-by-hand`);
  // An Entry's editor open.
  await p.getByRole("region", { name: "Entries" }).getByRole("button", { name: /Turkey sandwich/ }).click();
  await shot(p, `tour-${name}-01c-today-entry-editor`);
}

await sweep(await app.open("asher"), "phone");
await sweep(await app.open("asher", { device: "desktop" }), "desktop");
await sweep(await app.open("asher", { dark: true }), "dark");
const out = await app.open("asher", { signedOut: true });
await out.getByRole("button", { name: "Sign in with passkey" }).waitFor();
await shot(out, "tour-phone-00-login");
await app.close();
console.log(`screenshots in ${OUT}/tour-*.png`);
