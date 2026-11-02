# Browser checks (fake backend)

Headless Chromium (iPhone 13 profile, Pacific time) runs the built app with every network call
routed in-process: the real API handler on the in-memory table (`api/src/testing/fakeDynamo.ts`)
behind a GraphQL executor built from the composed `schema/*.graphql`, and a fake Cognito
(password `e2e-password`). Members are `asher` and `aubyn`. Nothing touches AWS. Copied from
Honey Do's e2e harness.

Not a workspace, so CI never installs it.

    npm run build:web          # repo root
    cd e2e && npm install && npx playwright install chromium
    npx tsx today.ts           # walking skeleton: sign in, log an Entry, totals, persistence
    npx tsx parity.ts          # Today parity: Goals, every Meal incl. Dessert, bars, water, weight, theme
    npx tsx estimate.ts        # type a Food, log the (stubbed) Bedrock estimate
<<<<<<< HEAD
    npx tsx week.ts            # Week streak/averages/total vs seeded Days; Trends metric chart
=======
    npx tsx guest.ts           # Guest mode: demo data, capped estimates (cap 2 here), leave Guest mode
>>>>>>> v1
    npx tsx passkeys.ts        # add a passkey, sign in with it (virtual authenticator), password backup
    npx tsx tour.ts            # screenshots of every tab: phone, desktop, dark

Screenshots go to `/tmp/e2e-nutrisage-<checkout folder>/` (override with `E2E_OUT`), so parallel
worktrees don't overwrite each other. Add a new check script per feature area (e.g. `week.ts`)
using `checklist()` from `lib.ts`, and add its screens to `tour.ts`.

Not covered: real device passkeys (Face ID, iCloud Keychain, phone QR; `passkeys.ts` uses a
Chromium virtual authenticator), iOS install quirks, offline launch (service workers are
blocked so routes see every request).
