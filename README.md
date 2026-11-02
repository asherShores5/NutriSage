# NutriSage

A nutrition tracker for one household. Each Member logs what they eat and drink each day against
their own goals, drawing on a shared Library of Foods and Recipes. Terms are in
[GLOSSARY.md](GLOSSARY.md); the plan is [docs/specs/2026-11-02-v1.md](docs/specs/2026-11-02-v1.md).

NutriSage is being rebuilt on the same stack as my other apps (TypeScript, React PWA, AppSync +
Lambda, DynamoDB, Cognito, CDK) for nutrisage.ashershores.com. Until cutover, the old plain-JS app
in [docs/](docs/) and its Python backend in [backend/](backend/) stay live at
[ashershores5.github.io/NutriSageAI](https://ashershores5.github.io/NutriSageAI).

## Layout

- `shared/`: pure domain logic (nutrients, Days, Entries, Meals)
- `api/`: the Member API Lambda (AppSync resolvers, one file per entity)
- `schema/`: the GraphQL schema, one file per entity, composed by `schema/compose.ts`
- `web/`: the React + Vite PWA
- `infra/`: CDK stacks
- `e2e/`: Playwright checks against an in-process fake backend (not a workspace)

## Develop

Node 22. From the repo root:

    npm install
    npm test            # vitest: shared, api, web, infra
    npm run typecheck   # tsc in every workspace
    npm run build:web   # web/dist
    AWS_REGION=us-west-1 AWS_DEFAULT_REGION=us-west-1 npm run synth   # cdk synth, no credentials needed

Browser checks (after `npm run build:web`):

    cd e2e && npm install && npx playwright install chromium
    npx tsx today.ts    # sign in, log an Entry, see Today
    npx tsx tour.ts     # screenshots: phone, desktop, dark

Running the web app against real AWS needs `web/public/config.json` (gitignored; copy
`config.example.json` and fill in the stack outputs). Nothing is deployed yet.

No AWS account or hosted zone IDs live in this repo; deploy-time values come from CDK context or
the environment.
