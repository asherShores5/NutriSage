// Visual sweep: the sign-in screen and every tab on phone, desktop, and phone in dark theme.
// Screenshots in $OUT/tour-* (see lib.ts). Look at them; DOM checks miss layout bugs.
import type { Page } from "playwright";
import { launch, todayKey } from "./app";
import { db, graphql, seed, seedLibrary } from "./backend";
import { lastDays } from "../shared/src/week";
import { OUT, shot, tab } from "./lib";

await seed(todayKey());
await seedLibrary([{ name: "Chicken breast" }, { name: "Chicken thigh" }, { name: "Chickpeas" }]);
// A few past Days (gaps included) so Week and Trends have a streak and a line to show.
for (const [i, date] of lastDays(todayKey(), 21).slice(0, -1).entries()) {
  if (i % 5 === 3) continue;
  const calories = 1700 + ((i * 137) % 600);
  await graphql("fake-id.asher", "mutation($input: DayInput!) { putDay(input: $input) { date } }", {
    input: { date, entries: [{ id: `h${i}`, meal: "dinner", name: "Past dinner", nutrition: { carbs: calories / 10, protein: 90, fat: 60, fiber: 25, sodium: 1800, iron: 9, calories } }], water: 6, weight: i % 3 ? null : 174 - i * 0.15 },
  });
}
// Two starred Library Foods, so Today shows a filled Quick Add row.
for (const [i, name] of ["Greek yogurt", "Rolled oats with a long name for wrapping"].entries()) {
  const id = `tour-food-${i}`;
  db.seed({ PK: "HOUSEHOLD", SK: `FOOD#${id}`, id, name, createdBy: "asher", updatedAt: 1, nutrition: { carbs: 0.2, protein: 0.1, fat: 0.05, fiber: 0, sodium: 1, iron: 0, calories: 0.8 }, units: [{ label: "serving", grams: 150 }, { label: "g", grams: 1 }] });
  await graphql("fake-id.asher", "mutation($input: FavoriteInput!) { putFavorite(input: $input) { libraryId } }", { input: { libraryId: id, lastUsed: Date.now() - i * 1000 } });
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
  // Trends with gaps: weight is logged every third Day, so the line is mostly dashed bridges.
  await tab(p, "Trends");
  await p.getByLabel("Metric").selectOption("weight");
  await p.waitForTimeout(200);
  await shot(p, `tour-${name}-03b-trends-weight-gaps`);
  // Y-axis modes and the goal line (calories: goal 2000 from seed()).
  await p.getByLabel("Metric").selectOption("calories");
  await p.getByLabel("Y-axis scale").selectOption("fit");
  await shot(p, `tour-${name}-03c-trends-fit-goal`);
  await p.getByLabel("Y-axis scale").selectOption("manual");
  await p.getByLabel("Y-axis min").fill("1800");
  await p.getByLabel("Y-axis max").fill("2200");
  await shot(p, `tour-${name}-03d-trends-manual`);
  // A second metric on the right-hand axis (calories vs weight), with its legend.
  await p.getByLabel("Y-axis scale").selectOption("zero");
  await p.getByLabel("Compare with").selectOption("weight");
  await p.waitForTimeout(200);
  await shot(p, `tour-${name}-03e-trends-second-metric`);
  await p.getByLabel("Compare with").selectOption("");
  // Fuzzy search matches under the add box (Chicken thigh picked with the arrow keys).
  await tab(p, "Today");
  await p.getByLabel("Food").fill("chick");
  await p.getByLabel("Food").press("ArrowDown");
  await p.getByLabel("Food").press("ArrowDown");
  await shot(p, `tour-${name}-01a-today-search`);
  await p.getByLabel("Food").fill("");
  // Today's form switched to typing nutrition by hand.
  await p.getByRole("button", { name: "Type nutrition by hand" }).click();
  await shot(p, `tour-${name}-01b-today-by-hand`);
  // An Entry's editor open.
  await p.getByRole("region", { name: "Entries" }).getByRole("button", { name: /^Turkey sandwich/ }).click();
  await shot(p, `tour-${name}-01c-today-entry-editor`);
  // Yesterday (Day navigation), away from today.
  await p.getByRole("group", { name: "Day" }).getByRole("button", { name: "Previous Day" }).click();
  await p.waitForTimeout(200);
  await shot(p, `tour-${name}-01d-yesterday`);
}

await sweep(await app.open("asher"), "phone");
await sweep(await app.open("asher", { device: "desktop" }), "desktop");
await sweep(await app.open("asher", { dark: true }), "dark");
const out = await app.open("asher", { signedOut: true });
await out.getByRole("button", { name: "Sign in with passkey" }).waitFor();
await shot(out, "tour-phone-00-login");
await app.close();
console.log(`screenshots in ${OUT}/tour-*.png`);
