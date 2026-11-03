## Agent skills (this repo overrides /workplace/shoresaj/CLAUDE.md)

Personal project in a public repo. Don't use Taskei, builder-mcp or any Amazon tool here,
and never put Amazon-internal content in files or commits. Keep AWS account IDs, hosted zone IDs,
secrets and Member passwords out of tracked files (the old per-user keys live in the gitignored
`keys.md`).

### Issue tracker

Local files. One ticket per file in `.scratch/<milestone>/issues/NN-<slug>.md` (gitignored),
numbered in dependency order. Blocking edges go in each file's "Blocked by" line. Close a ticket
by setting its `Status:` line to `done`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`) go in each ticket's `Status:` line.

### Domain docs

Single context: `GLOSSARY.md` and `docs/adr/` at the repo root. Specs live in `docs/specs/`
(current: `docs/specs/2026-11-02-v1.md`). Use the GLOSSARY terms (Day, Entry, Meal, Food, Recipe,
Library, Favorite, Quick Add, Member, Guest) in code and UI.

## Working rules

- Commit locally; push only when Asher says so. Pushes to `prod` deploy (CI, after Asher approves the `production` environment).
- Commit as `asher.shores5@gmail.com` (set in this repo's git config).
- Live AWS changes (deploys, deleting data or DNS records) need Asher's explicit go each time.
- Stack mirrors `../honeydo` and `../games-catalog` (TS workspaces shared/api/web/infra, CDK,
  AppSync + one Lambda, DynamoDB, PWA). Reuse their patterns before inventing new ones.

## Commands (repo root)

- `npm install` once (workspaces). `e2e/` is not a workspace: `cd e2e && npm install`.
- `npm test`: vitest in shared, api, web and infra.
- `npm run typecheck`: tsc in every workspace (web also checks the service worker).
- `npm run build:web`: typecheck + Vite build to `web/dist` (needed by e2e and by synth).
- `npm run synth`: `cdk synth` of every stack. Pin the region first:
  `AWS_REGION=us-west-1 AWS_DEFAULT_REGION=us-west-1 npm run synth` (the dev desktop sets
  AWS_REGION=us-west-2 globally). Synth needs no AWS credentials; with none it is env-agnostic.
- e2e (after `build:web`): `cd e2e && npx tsx today.ts` (checks) and `npx tsx tour.ts`
  (screenshots, phone/desktop/dark). Screenshots go to `/tmp/e2e-nutrisage-<checkout folder>/`.
  Look at them; passing DOM checks miss layout bugs. See `e2e/README.md`.

## Layout (built so tickets can work in parallel)

- `shared/src/`: pure domain logic, one file per area (`nutrients.ts`, `day.ts`, ...), each
  re-exported from `index.ts`. Any new pure logic goes here with a vitest test.
- `schema/`: the GraphQL schema split per entity. `base.graphql` declares `Query`, `Mutation` and
  `Nutrition`; each `<entity>.graphql` adds fields with `extend type Query { ... }`.
  `schema/compose.ts` merges them into one document for AppSync and the e2e backend.
- `api/src/`: `handler.ts` (Member allowlist, then dispatch by field name), `table.ts` (key layout,
  document client seam), `resolvers/<entity>.ts` (one `ResolverModule` per entity, merged in
  `resolvers/index.ts`).
- `infra/lib/`: `stacks.ts` (AppStack: table, Cognito, AppSync + Lambda), `guest.ts` (Guest endpoint + cap
  table), `hosting.ts` (CertStack, WebStack: S3 + CloudFront with the CSP from `csp.ts`), `ci.ts` (CiStack:
  the GitHub OIDC deploy role), `app.ts` (wires them; Cert/Web/Ci only with hosting config). The API Lambda
  gets explicit table actions (Get/Put/Update/Delete/Query): a resolver needing another one adds it in
  `stacks.ts` (and `infra/test/stacks.test.ts`). An AppSync resolver is created for every Query/Mutation field in the
  composed schema, so a new field needs only its schema line and its resolver.
- `web/src/`: `auth.ts` (Cognito JSON API), `config.ts` (runtime `/config.json`), `api/<entity>.ts`
  (GraphQL calls), `tabs.ts` (bottom tab registry), `components/` (shared by tabs, e.g. `Bars`), `views/<tab>/` (one folder per tab with its own
  components and CSS: today, week, trends, goals, profile). Today is split into `EntryForm` (add box),
  `EntryList` + `EntryEditor`, `Water`, `Weight`, and `components/Bars`; `views/goals/useGoals.ts` is the
  goals hook both Today and Goals read; `views/profile/useMealWindows.ts` likewise for Meal windows. These hooks
  (and Favorites) sit on `sync/memberData.ts` (the Member's local copy in localStorage, write-through via the
  pure outbox in `sync/outbox.ts`; reloads open Days, goals, Meal windows and Favorites on focus, visibility and
  `online`). A Day changed while this device may be behind the server (opened offline, offline since it
  loaded, or a write that had to wait) is three-way merged with the server's copy right before it's sent
  (`mergeDays` in shared), so offline logging never wipes another device's Entries; otherwise last write wins. `api/gql.ts` throws `NetworkError` for anything retryable. Theme: `src/theme.ts` + pre-paint `public/theme.js` (no inline scripts under the CSP). `sw/sw.ts` + `src/swShell.ts`: the
  hand-rolled service worker built by `vite.config.ts`.
- `e2e/`: Playwright against an in-process fake backend (`backend.ts`: the real handler on
  `api/src/testing/fakeDynamo.ts`, fake Cognito), launcher `app.ts`, helpers `lib.ts`. The app is served with
  the deployed CSP (`infra/lib/csp.ts`); any CSP violation fails the run.
- `api/src/migrate/`: the one-time migration from the old us-east-1 table (ticket 16). `migrate.ts` maps
  old rows to v1 items (deterministic ids, create-only writes, so re-runs change nothing); `cli.ts` is the
  script (dry run by default, `--apply` to write, target table from the `NutriSage` stack output). Tests in
  `api/src/migrate.test.ts` run a fixture export through it and read back via the handler. Cutover steps
  (Asher-only): `docs/cutover-runbook.md`; the old-Pages redirect page waits in `cutover/pages-redirect/`.
- `docs/` (except `docs/specs/`) and `backend/`: the OLD live app (plain JS on GitHub Pages, Python
  Lambda in us-east-1). Leave them untouched until cutover (ticket 16); ticket 24 removes them.

## Gotchas that will bite you

- **Data keys**: `MEMBER#<username>` / `DAY#YYYY-MM-DD` for a Member's Day; `HOUSEHOLD` for the
  shared Library. Partitions use the Cognito username (admin-created, allowlisted), not the sub.
  A Day write always carries the whole Day (Entries, water, weight): last write wins per Day.
  Favorites are one row each at `MEMBER#<username>` / `FAV#<libraryId>` with `lastUsed`; a put never
  moves `lastUsed` backwards (late outbox writes from another device). `deleteFood` clears an item from
  every Member's Favorites in its transaction; Quick Add (`quickAdd` in shared) skips orphans anyway. Web: `library/useFavorites.ts` (`useFavorites`,
  `useFavoriteIds` for search ranking, `noteLogged` after any add, `forgetFavorite` after a delete).
  Goals live at `MEMBER#<username>` / `GOALS` (0 = no goal; water defaults to 8 cups). Weight is > 0 or null
  (the old app's 0 meant not logged); water is whole cups.
- **Recipes** (`shared/src/recipe.ts`, ticket 17): `HOUSEHOLD` / `RECIPE#<id>` beside `FOOD#<id>`; the id is chosen by the
  client (`addRecipe(id, input)`, a retry returns the saved one) so the Entry can point at it at once. Ingredients are
  snapshots (name, amount, unit, grams, nutrition, Yield ratio), not live links. A Recipe Entry carries `ingredients`
  (its breakdown for that portion), which `rescaleEntry` scales with it. `preparedWeight` is the weighed
  value, else (ticket 18) the sum of ingredient grams x Yield ratio (1 when unknown; null if any grams are unknown), with
  a `source` the builder shows; the estimate is never saved as `preparedGrams`. Logging in g needs one of the two; a
  fraction of the batch (unit `batch`) never does. Adding a Library Food with no ratio calls `suggestYieldRatio(id)`
  (Bedrock, saved on the Food; never overwrites a ratio already there; Guests skip it to spare their cap); a typed ratio
  is saved via `putFood` on blur. The builder is a portal over Today.
  Recipe Book (ticket 19, `shared/src/recipeBook.ts`): Recipes are in `useLibrary().items` with the Foods, so search, Quick Add
  and stars cover both; Quick Add (or any unit a Recipe lacks) logs `QUICK_ADD_PORTION` (1/4 batch). `putRecipe` / `deleteRecipe`
  mirror putFood/deleteFood (delete clears every Member's Favorite). A saved Recipe as an ingredient carries its own breakdown in
  `ingredients` (Foods only, no Yield ratio: it counts at its own weight); `checkRecipe` refuses a deeper breakdown and
  `nestingError` (API, Guest store) refuses pointing at a Recipe that has one, a Recipe in itself, or giving a Recipe a Recipe
  while another uses it. Editing (builder given `recipe`, opened from Profile > Library) rescales saved ingredient snapshots,
  never re-reading the Food.
- **Two allowlists**: Cognito has no self sign-up, and the Lambda also refuses any username not in
  `ALLOWED_USERNAMES` (`USERNAMES` in `infra/lib/stacks.ts`), even with a valid token.
- **Passkeys** (Cognito native, USER_AUTH): the relying party is `APP_DOMAIN`, so a passkey only
  works on that exact host (not localhost or a CloudFront URL) and an RP change orphans every
  passkey. The password stays as the backup first factor; passkey-only sign-in is out of scope.
  e2e covers the WebAuthn path with a Chromium virtual authenticator (`e2e/passkeys.ts`); real
  Face ID, iCloud Keychain and phone-QR sign-in get checked on device after deploy.
- **The handler reads env at import time**: tests and e2e import it through
  `api/src/testing/harness.ts` / `e2e/backend.ts`, which set the env first. Never import it statically in a test.
- **fakeDynamo throws on anything it doesn't support**; extend its parsers when a resolver needs more.
- **Junk numbers become 0, never NaN** (`num()` in shared). Bedrock replies and old data can hold
  junk; don't "simplify" the coercion away. The API refuses non-finite or negative nutrients.
- **Food names are untrusted**: render them as React text, never `dangerouslySetInnerHTML`.
- **Bedrock**: model access is region- and account-gated and needs an *active* US
  inference profile ID (the `us.` prefix); invoking the bare model ID on demand fails. Keep a
  Sonnet-class model: estimates are mostly recall of branded and restaurant items, where Haiku
  underestimated portions. The model is `ESTIMATE_MODEL` in `infra/lib/estimate.ts` (Sonnet 4.6,
  called from us-west-1 via `us.anthropic.claude-sonnet-4-6`; Sonnet 5.x isn't offered to the
  account yet); it sets `MODEL_ID` and an InvokeModel grant on the profile + its 4 US model ARNs.
  The estimate core (prompt, length cap, lenient parse) is `api/src/estimate.ts`, shared by the
  Member `estimate` mutation and the Guest endpoint; tests stub Bedrock via `testing/fakeBedrock.ts`.
- **Guest mode** (ticket 10): `web/src/session.ts` holds the Guest flag; `web/src/api/*.ts` check
  `isGuest()` and answer from browser storage (`web/src/guest/store.ts`, seeded by `guestSeed` in
  shared) or the Guest endpoint, so screens never branch on Guests for data. Every api/ module
  (Days, goals, Meal windows, Library, Recipes, Favorites, estimates) has that branch, and a new one must
  too; a Guest never sees the household Library. Screens may check `isGuest()` only for Guest-specific
  UI and wording, never to read or write data: the sign-in gate (`App.tsx`), the Guest banner
  (`Shell.tsx`), the Guest Profile with Leave Guest mode, and copy that says where the data lives
  (Profile and Library hints: "on this device" vs "you both share"). That's clearer than routing copy
  through the session layer.
  The Guest endpoint is `api/src/guest.ts` behind its own public HTTP API (`infra/lib/guest.ts`,
  output `GuestEstimateUrl`, `guestEstimateUrl` in config.json). It must never import `table.ts`
  or `resolvers/`; its role has only Bedrock + UpdateItem on the Guest cap table. Caps
  (`GUEST_CAPS`: per IP or IPv6 /64, and a global ceiling, per UTC day) are checked in one
  transaction before Bedrock; counters hold a hash of day + network, never the IP, and expire by TTL.
- **The old backend** (until ticket 24): an Organizations SCP blocks public Lambda Function URLs,
  which is why it sits behind an HTTP API. Its `update-function-configuration --environment`
  replaces the whole variable map, so re-send every variable together.
- **GitHub Pages** (`.github/workflows/static.yml`) still uploads the whole repo on push to `main`
  for the old app; the Pages URL path depends on the repo name, so the rename waits for cutover.
- Not testable in e2e: real device passkeys (Face ID, Keychain, phone QR), iOS install quirks. Service workers are blocked
  by default; `e2e/offline.ts` opts in (`open(user, { serviceWorkers: true })`) and uses `setOffline(page, on)`.
  Verify those on device after deploy.

## Accepted deviations from the spec (decided; don't "fix" them)

- Amounts in g go up to 5000 (other units 100), so a weighed plate fits.
- Meal windows are start times (each Meal runs until the next starts), and the picked Meal resets to the
  current window when the date rolls over while the app stays open.
- Guest caps live in their own table (`infra/lib/guest.ts`), so the Guest Lambda has no grant on Member data.
- Today has a Clear day button (asks first; keeps water and weight).
- Quick Add (or any unit a Recipe lacks) logs a Recipe as 1/4 of the batch (`QUICK_ADD_PORTION`).
- The estimate model is Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6`), at the model's default temperature;
  Sonnet 5.x isn't offered to the account yet.
- A new Food estimated in a unit other than serving (g, oz, cup...) is estimated for exactly that amount, and
  the Food gets that unit with Bedrock's grams (`portionedServing` in shared).
- Migration: an old `(×N)` name suffix becomes an amount of N servings; nutrition is kept exactly, even past
  the API's ceiling (reported, see the cutover runbook).

