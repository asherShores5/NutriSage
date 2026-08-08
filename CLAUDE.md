# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this actually is

A single-page, client-side PWA for a small family (3 profiles: asher, aubyn, tommy) to track daily food nutrition, with a single serverless backend that (1) estimates nutrition via Bedrock and (2) syncs each user's data across devices via DynamoDB. No build step. Frontend is plain HTML/CSS/JS in [docs/](docs/); backend is one AWS Lambda in [backend/](backend/).

## Architecture

- **Entry points**: root [index.html](index.html) is a meta-refresh redirect to [docs/index.html](docs/index.html), the real app. GitHub Pages serves both, so the redirect makes the bare project URL work.
- **App logic**: all in [docs/script.js](docs/script.js). **localStorage is the working copy; the server is the sync layer** — every mutation updates the per-user cache (`nutri:<user>`) instantly, then write-throughs to the API best-effort (offline still works locally). Flow on open: pick profile → (key auto-supplied if this device has seen it, else paste once) → `/pull` loads days + goals + shared meals. Rows/bars/chips are all built with `createElement`/`textContent` (never `innerHTML`) — food names are untrusted; keep it that way.
- **UI is tabbed** (bottom tab bar): **Today** (progress bars, add-food, entries grouped by meal, water), **Week** (streak + daily average + week total), **Trends** (30-day canvas line chart, no chart lib), **Goals**, **Profile** (switch profile, theme, data controls).
- **Device keyring**: `nutri:keys` (`{user: secret}`) remembers every profile authenticated on THIS device, so switching profiles never re-asks for a key; `nutri:active` is the last profile (auto-resumed on open). Keys are cleared per-device from the Profile tab. Theme pref in `nutri:theme` (`system`|`light`|`dark`), applied pre-paint by an inline script in [docs/index.html](docs/index.html).
- **Guest mode**: a keyless, local-only profile (`user === 'guest'`, `secret === null`) so anyone can view + test the app. `pull()`/`pushItem()` short-circuit for the guest (never hit the authed endpoints — they'd 401); its data lives in `nutri:guest` and is never synced. First entry seeds a few demo days (`seedGuestDataIfEmpty`) so charts/week aren't empty. The one server call a guest makes is the public macro endpoint, so `getMacroData` enforces a client-side quota (`GUEST_DAILY_LOOKUPS`/day, tracked in `nutri:guestQuota`, throwing `GuestLimitError`) — a soft UX guard on top of the real gates (API throttle + budget). "Exit guest mode" wipes `nutri:guest`/`nutri:guestQuota` and reloads.
- **Nutrients tracked** (one shared list, `MACRO_KEYS` in macros.js): `carbs, protein, fat, fiber` (g), `sodium, iron` (mg), `calories`. Add/remove a nutrient = edit `MACRO_KEYS` + the Bedrock prompt + `MACRO_ROWS`/`MICRO_ROWS` in script.js + a goals input. Bars are split into **Macros** vs **Micronutrients** groups.
- **Macro helpers**: [docs/macros.js](docs/macros.js) (`num`, `sumMacros`, `dateKey`, `weekKeys`, `lastDays`, `sumWeek`, `scaleMacros`, `weekStats`, `streak`, `pct`, `barState`, `energyBalance`, `MACRO_KEYS`) is pure, no DOM/network, shared with the Node test [docs/macros.test.js](docs/macros.test.js). Run `node docs/macros.test.js`. **Any new pure logic goes here with a test** — it's the only test harness.
- **Bar coloring**: most bars use `barState` (independent goal: green within ±10%, red >10% over; protein/fiber are "more-is-good" so never red). **Carbs and fat are the exception** — they're interchangeable energy (4 vs 9 cal/g), so `energyBalance` judges them as one shared caloric pool. Over one but under the other by the same calories is a **`spill`** (amber, with a `⇄ N cal swapped` caption), not a red `over`; red only fires when the *combined* carb+fat calories exceed the combined goal by >10%. Needs both goals set, else it falls back to independent `barState`. Protein/calories are untouched (calories is just the conversion unit). `renderBarGroups` in script.js applies this; only carbs/fat bars get a spill caption.
- **Backend** ([backend/lambda_function.py](backend/lambda_function.py)), one Lambda, path-routed via the HTTP API's `$default`:
  - `POST /` — `{foodItem}` → `{carbs,protein,fat,fiber,sodium,iron,calories}` via **Amazon Bedrock** (see Model below). No auth.
  - `POST /pull` / `POST /push` — per-user data sync, **secret-gated** (see Auth below).
  - `OPTIONS *` → 204 for the CORS preflight (quick-create routes ANY / here too).
- **Auth**: per-user shared secret. Only SHA-256 **hashes** live in the Lambda env var `USER_SECRETS` (`{user: sha256hex}`); the client sends the plaintext key, the Lambda hashes + constant-time compares. No passwords, no Cognito. Secrets are user-entered, cached in their localStorage, and **never** in the repo. Local secrets are recorded in the gitignored `keys.md`.
- **Data** (DynamoDB `nutrisageai-data`, on-demand): `pk=user, sk=date|goals`; shared meal library at `pk=household, sk=meals`. A day row body is `{entries:[{food,macros,meal}], water, updatedAt}` (`meal` is breakfast|lunch|dinner|snack; `water` is a cup count). Goals include per-macro targets plus `waterGoal`. Each row's body is a JSON string in a `data` attribute (table is a dumb blob store — no Decimal/float juggling). Conflict strategy is **last-write-wins per day** — a day write (`writeDay`) always sends both `entries` and `water` so one never clobbers the other.
- **PWA**: [docs/service-worker.js](docs/service-worker.js) is network-first for same-origin GETs, scope-relative paths. **Bump `CACHE_NAME` (currently `v9`) on any asset change** so returning users get fresh files. [docs/manifest.json](docs/manifest.json) has `id`/`scope`/`start_url`.

## Deploying

- **Frontend**: push to `main`. [.github/workflows/static.yml](.github/workflows/static.yml) uploads the **entire repo** to GitHub Pages — no build. Live at https://ashershores5.github.io/NutriSageAI.
- **Backend**: `cd backend && ./deploy.sh` (packages + updates the Lambda; role/API already exist).

## AWS backend (account 334772842524, us-east-1)

- Lambda `nutrisageai-macro`, HTTP API `nutrisageai-api` (id `q8f8dfzb0j`), DynamoDB `nutrisageai-data` (on-demand), IAM role `nutrisageai-macro-role` (least-privilege: `bedrock:InvokeModel` on the one model + `GetItem`/`PutItem`/`Query` on the one table + logging).
- **Adding a family member**: add the name (lowercase) to `PROFILES` in [docs/script.js](docs/script.js), generate a secret, and add its SHA-256 hash to the Lambda's `USER_SECRETS` env var. No schema change (new user = new `pk`). The env update via `update-function-configuration --environment` **replaces the entire var map** — always re-send `MODEL_ID`, `DATA_TABLE`, and `USER_SECRETS` together (fetch current values first) or the others get wiped. The shorthand parser can't handle the nested-JSON `USER_SECRETS` value; pass `--environment file://<file>.json`. Verify the hash matches `python -c "import hashlib; print(hashlib.sha256('<secret>'.encode()).hexdigest())"` before deploying. Record the plaintext in the gitignored `keys.md`.
- **Why API Gateway, not a Lambda Function URL**: an Organizations SCP blocks public Function URLs (they 403 even with a correct resource policy). API Gateway is allowed. Don't waste time re-trying Function URLs here.
- **Abuse controls**: HTTP API throttled to 5 req/s, burst 10; account Lambda concurrency cap is 10 (hard blast-radius limit); a $10 zero-spend AWS budget acts as a cost tripwire. CORS is locked to the GitHub Pages origin + localhost:8000.

## Gotchas that will bite you

- **API endpoint is hardcoded** as `API_URL` in [docs/script.js](docs/script.js) — no `.env`/config. If you redeploy the API and the ID changes, update this string. CORS is origin-locked, so `file://` won't work; serve over http on port 8000 when testing the fetch path.
- **Bedrock model access** is region- and account-gated and must be an *active* (non-legacy) inference profile — hence the `us.` prefix. On-demand invocation of the bare model ID fails; use the inference profile ID.
- **Model is Sonnet 4.5** (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, in `MODEL_ID`). It was upgraded from Haiku 4.5 because this turned out to be a knowledge-recall task (branded/restaurant nutrition facts) where Haiku systematically underestimated brand-item portions. The code comment in `_macros` explains it. Swap models via the env var — but the same "re-send all env vars together" rule above applies, and any classifier/reviewer may flag a `MODEL_ID` change; a full-env resend that keeps the value identical is not a change.
- The frontend keeps nutrient summing tolerant of junk API responses (`Number(x) || 0`); don't "simplify" that away — it prevents `NaN` totals.

## Testing / verifying changes

- `node docs/macros.test.js` — the only test harness (pure helpers). Add cases when you touch macros.js.
- Syntax-check without running: `node -e "new Function(require('fs').readFileSync('docs/script.js','utf8'))"` and `python -c "import ast; ast.parse(open('backend/lambda_function.py').read())"`.
- Smoke-test live: `curl -s -X POST <API_URL>/ -d '{"foodItem":"apple"}'` (macros) and `/pull` with `{"user","secret"}` (a `200` means the key works).
