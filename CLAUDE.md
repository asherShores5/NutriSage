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

- Commit locally; push only when Asher says so. Once deploy CI exists (ticket 11), pushes to `prod` deploy.
- Commit as `asher.shores5@gmail.com` (set in this repo's git config).
- Live AWS changes (deploys, deleting data or DNS records) need Asher's explicit go each time.
- Stack mirrors `../honeydo` and `../games-catalog` (TS workspaces shared/api/web/infra, CDK,
  AppSync + one Lambda, DynamoDB, PWA). Reuse their patterns before inventing new ones.

## Commands (repo root)

- `npm install` once (workspaces). `e2e/` is not a workspace: `cd e2e && npm install`.
- `npm test`: vitest in shared, api, web and infra.
- `npm run typecheck`: tsc in every workspace (web also checks the service worker).
- `npm run build:web`: typecheck + Vite build to `web/dist` (needed by e2e and, from ticket 11, by synth).
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
  `resolvers/index.ts`). Placeholders exist for goals, favorites, library and estimate: fill the
  file, no index edit needed.
- `infra/lib/`: `stacks.ts` (AppStack: table, Cognito, AppSync + Lambda), `app.ts` (wires stacks;
  ticket 11 adds Cert/Web/Ci). An AppSync resolver is created for every Query/Mutation field in the
  composed schema, so a new field needs only its schema line and its resolver.
- `web/src/`: `auth.ts` (Cognito JSON API), `config.ts` (runtime `/config.json`), `api/<entity>.ts`
  (GraphQL calls), `tabs.ts` (bottom tab registry), `views/<tab>/` (one folder per tab with its own
  components and CSS: today, week, trends, goals, profile). `sw/sw.ts` + `src/swShell.ts`: the
  hand-rolled service worker built by `vite.config.ts`.
- `e2e/`: Playwright against an in-process fake backend (`backend.ts`: the real handler on
  `api/src/testing/fakeDynamo.ts`, fake Cognito), launcher `app.ts`, helpers `lib.ts`.
- `docs/` (except `docs/specs/`) and `backend/`: the OLD live app (plain JS on GitHub Pages, Python
  Lambda in us-east-1). Leave them untouched until cutover (ticket 16); ticket 24 removes them.

## Gotchas that will bite you

- **Data keys**: `MEMBER#<username>` / `DAY#YYYY-MM-DD` for a Member's Day; `HOUSEHOLD` for the
  shared Library. Partitions use the Cognito username (admin-created, allowlisted), not the sub.
  A Day write always carries the whole Day (Entries, water, weight): last write wins per Day.
- **Two allowlists**: Cognito has no self sign-up, and the Lambda also refuses any username not in
  `ALLOWED_USERNAMES` (`USERNAMES` in `infra/lib/stacks.ts`), even with a valid token.
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
- **The old backend** (until ticket 24): an Organizations SCP blocks public Lambda Function URLs,
  which is why it sits behind an HTTP API. Its `update-function-configuration --environment`
  replaces the whole variable map, so re-send every variable together.
- **GitHub Pages** (`.github/workflows/static.yml`) still uploads the whole repo on push to `main`
  for the old app; the Pages URL path depends on the repo name, so the rename waits for cutover.
- Not testable in e2e: real passkeys (WebAuthn), iOS install quirks, offline launch (service
  workers are blocked so routes see every request). Verify those on device after deploy.
