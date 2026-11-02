# Cutover runbook (ticket 16): migrate, check, rename, redirect, App Connector

**Every step here is Asher-only.** Each one is a live change (AWS writes, GitHub repo settings, a
deploy), so Asher runs it, or says go, one step at a time. Stop at any step that doesn't look the
way it says it should.

Before you start: `docs/deploy-runbook.md` is done through step 9 (the stacks are deployed, the
anonymous checks pass, asher and aubyn exist and can sign in). The old app (GitHub Pages + the
us-east-1 Lambda and table) keeps running throughout. Retiring it is ticket 24, later, with its own go.

Shell setup for every step (VS Code terminal on the dev desktop, repo root):

```sh
aws login --remote --region us-west-1 --profile personal   # if `aws sts get-caller-identity` fails
export AWS_PROFILE=personal AWS_REGION=us-west-1 AWS_DEFAULT_REGION=us-west-1
aws sts get-caller-identity --query Arn --output text       # expect .../user/ashershores
```

## 0. Back up the old table (it has no point-in-time recovery)

Ask Aubyn to stop logging in the old app from now on (anything logged there after step 2 won't
come across).

```sh
aws dynamodb create-backup --region us-east-1 --table-name nutrisageai-data \
  --backup-name "nutrisageai-data-pre-cutover-$(date +%F)" --query BackupDetails.BackupArn --output text
aws dynamodb list-backups --region us-east-1 --table-name nutrisageai-data \
  --query 'BackupSummaries[].[BackupName,BackupStatus,BackupSizeBytes]' --output table   # expect AVAILABLE
```

Also keep a local copy (personal data, so it stays in the gitignored `.secrets/`):

```sh
mkdir -p -m 700 .secrets
aws dynamodb scan --region us-east-1 --table-name nutrisageai-data --output json > ".secrets/old-table-$(date +%F).json"
chmod 600 .secrets/old-table-*.json
python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['Items']), 'rows')" .secrets/old-table-*.json
```

On-demand backups cost a few cents a month and stay until deleted (ticket 24 decides when).

## 1. Dry run (writes nothing)

```sh
npx tsx api/src/migrate/cli.ts            # same as --dry-run
```

It scans the old table (read-only), finds the new table from the `NutriSage` stack's `TableName`
output in us-west-1, and prints what it would do. As of 2026-11-02 (a dry run on the real table):

```
kind      would create  unchanged  differs (kept)
Day       172           0          0          asher 119 + aubyn 53
Goals     2             0          0
Food      45            0          0          26 old Favorites + 20 quick-add meals, 1 name in both
Favorite  26            0          0          asher 24 + aubyn 2
Entries in migrated Days: 1891
Skipped old rows: tommy 2
```

Numbers creep up if the old app was used since. What to check:

- `unchanged` and `differs` are 0 the first time. Anything in `differs` means the new table
  already has that item with different content: stop and look before applying.
- A line `Old Library items matched to Foods already in the Library: ...` means a Food of that name
  was saved in the new app already (e.g. while testing). The old Favorite points at that Food,
  so Food `create` drops by one for each. That's expected.
- The script refuses to run (and writes nothing) if any planned Day or goals would fail the API's
  own validation, with one exception: nutrition is kept exactly as logged, never capped. An Entry
  with a nutrient past the API's ceiling (100,000) is written as it is and listed on a line
  `Over the API's limits (written as they are): ...`. The old table had none on 2026-11-02 (largest:
  1,850 calories, 3,800 mg sodium). If one shows up, it's almost surely a typo: after the
  migration, delete or re-log that Entry in the app, because the API refuses to save a Day that
  still holds it.

What the mapping does (spec: Migration and cutover):

- Days keep each Entry's exact nutrition snapshot and Meal; a missing Meal becomes Snack. Old rows
  missing fiber, sodium or iron get 0. A `(×N)` suffix on a name becomes an amount of N servings
  (the snapshot is already for N) and leaves the name; a suffix that isn't a valid amount stays in
  the name. (Accepted deviation from the spec, which says Entries move unchanged: the old app
  baked the portion into the name, so reading it into an amount keeps the same totals and lets the
  editor rescale it.) Migrated Entries have no Library reference.
- Weight 0 or missing means not logged (null). Water null becomes 0 cups.
- Goals carry over; the old `waterGoal` becomes the water goal (8 cups when there was none).
- Old Favorites and the household quick-add meals become Foods, one per name (ignoring case),
  as one serving with unknown grams (a `serving` unit only, like ticket 12's unweighed Foods).
  Give one a real serving weight later in Profile > Library to unlock grams. Old Favorites also
  become Favorites; Quick Add is ordered by when each was last logged in the old app.
- Tommy is skipped.

## 2. Migrate

```sh
npx tsx api/src/migrate/cli.ts --apply
```

The `created` column must match step 1's `would create`. Then run the dry run again: every row
must show 0 `would create` and everything under `unchanged`. That's the idempotency check.

It only ever creates: every id comes from the old data, so a re-run plans the same items and leaves
anything already there alone. Something changed in the new app since shows under `differs (kept)`
and is never overwritten. If the run stops halfway (network, expired login), log in again and
re-run: it picks up where it stopped.

## 3. Asher checks his history (and Aubyn hers)

On https://nutrisage.ashershores.com, signed in, compare with the old app (still live):

- Today, then step back through a few Days, including an old one (July): same Entries, Meals and
  totals. An old `eggs (×2)` Entry reads "eggs", 2 servings, with the same nutrition.
- Goals tab: same targets and water goal.
- Week and Trends: weight shows on the Days you logged it (39 Days in total), with gaps elsewhere.
- Quick Add: your old favorites (asher 24, aubyn 2). Profile > Library: the quick-add meals are there.

If something is wrong, stop here. Don't rename or redirect: the old app still works, so nothing is
lost. Fix the script, then remove the bad items from the new table (each delete needs your go) and
re-run step 2, which re-creates only what's missing.

## 4. Rename the GitHub repo to NutriSage

```sh
gh repo rename NutriSage -R asherShores5/NutriSageAI --yes
git remote set-url origin https://github.com/asherShores5/NutriSage.git   # in every local clone
gh repo view asherShores5/NutriSage --json name,id --jq '.name + " " + .id'  # the ID doesn't change
```

- CI keeps deploying: the deploy role trusts both repo names (`GITHUB_REPO_NAMES` in
  `infra/lib/ci.ts`).
- **The old app's address breaks right away.** GitHub redirects the repo's web and git URLs after
  a rename, but not project Pages URLs, so `ashershores5.github.io/NutriSageAI/` 404s until step 5.
  Do step 5 straight after.
- The renamed repo's own Pages site moves to `/NutriSage/`, where nobody goes. Unpublish it:

  ```sh
  gh api -X DELETE repos/asherShores5/NutriSage/pages
  ```

  and, in the next PR to `main`, delete `.github/workflows/static.yml` (it would otherwise fail on
  every push to `main` now that Pages is off). `docs/` and `backend/` stay until ticket 24.

## 5. Turn the old Pages address into a redirect

Old bookmarks and the old home-screen icon point at `ashershores5.github.io/NutriSageAI/...`. After
the rename that path belongs to no repo, so a small new public repo named `NutriSageAI` takes it
over and serves only the redirect page. The page is ready in `cutover/pages-redirect/` (the same
page as `index.html`, `docs/index.html` (the old app's address) and `404.html` (any other old path)).
It also removes the old app's service worker and caches, then goes to
https://nutrisage.ashershores.com/.

```sh
src="$PWD/cutover/pages-redirect"
tmp=$(mktemp -d) && cp -r "$src/." "$tmp" && cd "$tmp"
git init -b main && git add -A
git -c user.name="Asher Shores" -c user.email=asher.shores5@gmail.com commit -m "NutriSage moved to nutrisage.ashershores.com"
gh repo create asherShores5/NutriSageAI --public --source . --push \
  --description "Moved to https://nutrisage.ashershores.com" --homepage https://nutrisage.ashershores.com
gh api -X POST repos/asherShores5/NutriSageAI/pages -f "source[branch]=main" -f "source[path]=/"
cd - && rm -rf "$tmp"
```

Pages takes a minute or two. Then:

```sh
for p in "" docs/ docs/index.html docs/script.js; do
  printf '%-18s ' "/$p"; curl -s -o /tmp/r.html -w '%{http_code} ' "https://ashershores5.github.io/NutriSageAI/$p"; grep -c 'has moved' /tmp/r.html
done   # expect 200 1, 200 1, 200 1, 404 1
```

On the iPhone, open the old NutriSage home-screen icon: it should land on the new site. Then
delete the old icon and add the new site with Share > Add to Home Screen (deploy runbook step 8).

Notes:
- Creating a repo with the old name ends GitHub's redirect from `github.com/asherShores5/NutriSageAI`
  to the renamed repo. That's why step 4 updates the git remotes first.
- The stub repo has no workflows and no `production` environment; keep it that way. The deploy role
  still trusts the old name's `production` subject, so a `production` environment in the stub could
  deploy. Close that by removing the old name from the trust (same day, normal PR + prod deploy):

  ```diff
  --- a/infra/lib/ci.ts
  -/** The repo's names: it's renamed from NutriSageAI to NutriSage at cutover (spec), so both are trusted. */
  -export const GITHUB_REPO_NAMES = ["NutriSageAI", "NutriSage"];
  +/** The repo's name (renamed from NutriSageAI at cutover; that name is now the Pages redirect stub). */
  +export const GITHUB_REPO_NAMES = ["NutriSage"];
  ```

  Ship it after the rename (the deploy runs as `NutriSage`). `infra/test/hosting.test.ts` pins the
  trusted subjects: drop its two `NutriSageAI` subject lines in the same change. Also update `gh api repos/asherShores5/NutriSageAI` to `.../NutriSage` in
  `docs/deploy-runbook.md` step 1.

## 6. Point the App Connector Tile at the new NutriSage

In `../app-connector` (its own repo and ship flow: tests, PR to `main`, then `main` to `prod`,
Asher approves the deploy):

`web/src/tiles.ts`:

```diff
-  { name: "NutriSageAI", url: "https://ashershores5.github.io/NutriSageAI/docs/", icon: "/icons/nutrisageai.png" },
+  { name: "NutriSage", url: "https://nutrisage.ashershores.com", icon: "/icons/nutrisage.png" },
```

`web/src/tiles.test.ts` (the pinned list):

```diff
-      { name: "NutriSageAI", url: "https://ashershores5.github.io/NutriSageAI/docs/" },
+      { name: "NutriSage", url: "https://nutrisage.ashershores.com" },
```

The icon, renamed to match (optionally replaced with the new app's icon, a PNG):

```sh
git mv web/public/icons/nutrisageai.png web/public/icons/nutrisage.png
# optional: cp ../nutrisage/web/public/android-chrome-512x512.png web/public/icons/nutrisage.png
```

Docs in the same commit: `docs/specs/2026-10-30-v1.md` (Tiles list item 2 becomes
`NutriSage, https://nutrisage.ashershores.com`) and `GLOSSARY.md` (`NutriSageAI` becomes `NutriSage`
in **App**). Then `grep -rni nutrisageai web e2e docs GLOSSARY.md` should find nothing. After the
deploy, close and reopen Apps on the iPhone (twice if the old Tile sticks).

## 7. Later

Ticket 24, each deletion with its own go: delete the old us-east-1 Lambda, HTTP API, table (the
step 0 backup stays) and role, and remove `docs/` (except `docs/specs/` and the runbooks),
`backend/` and `cutover/` from the repo.
