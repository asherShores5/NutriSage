// Old-table rows (made-up values, real shapes) as a Scan returns them in DynamoDB JSON, for the
// migration tests. Shapes from the old app (docs/script.js, backend/lambda_function.py).
const row = (pk: string, sk: string, data: unknown) => ({ pk: { S: pk }, sk: { S: sk }, data: { S: JSON.stringify(data) } });

export const OLD_ROWS = [
  // Day, full shape: one Entry with a portion suffix, one legacy Entry with no Meal and missing nutrients.
  row("asher", "2026-08-14", {
    entries: [
      { food: "oatmeal with banana", macros: { carbs: 54, protein: 8, fat: 5, fiber: 7, sodium: 10, iron: 2.1, calories: 290 }, meal: "breakfast" },
      { food: "string cheese (×2)", macros: { carbs: 2, protein: 14, fat: 12, fiber: 0, sodium: 400, iron: 0, calories: 160 }, meal: "snack" },
      { food: "chicken burrito bowl", macros: { carbs: 70, protein: 45, fat: 24, calories: 680 } },
    ],
    water: 6, weight: 171.4, updatedAt: "2026-08-14T23:10:02.114Z",
  }),
  // Older shape: no weight key, water null.
  row("aubyn", "2026-07-09", {
    entries: [{ food: "pb&j", macros: { carbs: 48, protein: 12, fat: 16, calories: 380 }, meal: "lunch" }],
    water: null, updatedAt: "2026-07-09T19:02:44.000Z",
  }),
  // Minimal and empty.
  row("asher", "2026-07-07", { entries: [], updatedAt: "2026-07-07T15:00:00.000Z" }),
  // weight 0 meant "not logged".
  row("asher", "2026-07-08", {
    entries: [{ food: "apple", macros: { carbs: 25, protein: 0.5, fat: 0.3, fiber: 4.4, sodium: 2, iron: 0.2, calories: 95 }, meal: "snack" }],
    water: 0, weight: 0, updatedAt: "2026-07-08T18:00:00.000Z",
  }),
  row("asher", "goals", { carbs: 250, protein: 160, fat: 75, fiber: 35, sodium: 2300, iron: 8, calories: 2400, waterGoal: 10 }),
  row("aubyn", "goals", { carbs: 180, protein: 110, fat: 60, fiber: 28, sodium: 2000, iron: 18, calories: 1800 }),
  row("asher", "favorites", {
    favorites: [
      { name: "protein shake", macros: { carbs: 5, protein: 30, fat: 2, fiber: 1, sodium: 180, iron: 1, calories: 160 } },
      { name: "Costco hot dog", macros: { carbs: 46, protein: 24, fat: 32, fiber: 2, sodium: 1700, iron: 3.4, calories: 570 } },
    ],
  }),
  // The household quick-add library: overlaps a Favorite by name (different case).
  row("household", "meals", {
    library: [
      { name: "costco hot dog", macros: { carbs: 46, protein: 24, fat: 32, fiber: 2, sodium: 1700, iron: 3.4, calories: 570 } },
      { name: "greek yogurt", macros: { carbs: 6, protein: 17, fat: 0, fiber: 0, sodium: 60, iron: 0, calories: 90 } },
    ],
  }),
  // Tommy is not migrated.
  row("tommy", "goals", { carbs: 200, protein: 100, fat: 60, fiber: 25, sodium: 2300, iron: 10, calories: 2000 }),
  row("tommy", "2026-09-01", { entries: [{ food: "toast", macros: { carbs: 15, calories: 80 }, meal: "breakfast" }], updatedAt: "2026-09-01T12:00:00.000Z" }),
];
