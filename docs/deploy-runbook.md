# Deploy runbook (first deploy, then CI)

Human steps only: every step here is a live change or a GitHub setting, so Asher runs it (or says
go). After the first deploy, a push to `prod` deploys through GitHub Actions once Asher approves
the run. Nothing below goes in a tracked file: the account ID and zone ID are env vars or GitHub
settings.

What gets created (all us-west-1 except the certificate):

```
NutriSage       table, Cognito user pool (no users yet), Member API (AppSync + Lambda),
                Guest estimate endpoint (HTTP API + Lambda, no table access), $2/month budget
NutriSageCert   us-east-1 certificate for nutrisage.ashershores.com (DNS-validated)
NutriSageWeb    private S3 bucket, CloudFront (the only reader, via OAC), CSP/headers, A/AAAA records
NutriSageCi     nutrisage-github-deploy role: trusts only this repo's `production` environment
```

The old app (GitHub Pages + the us-east-1 Lambda) keeps running untouched; cutover is a later ticket.

## Release rule (builder-security)

The static shell is public by design (no data, Guests use it without signing in). Member data is
the restricted content. So the order is fixed:

1. Deploy with an empty table and a user pool with no users.
2. Run the anonymous checks (step 5). Every one must PASS: the Member API refuses anonymous and
   junk-token calls, self sign-up is off, the bucket refuses direct reads, the Guest endpoint
   answers only `POST /estimate` and only for the app's origin.
3. Only then create the Members (step 7), and only after that migrate any data.

If any check fails, stop. Don't create users or migrate until it's fixed and re-checked.

## 1. Shell setup and values

From the repo root, in the VS Code terminal on the dev desktop:

```sh
aws login --remote --region us-west-1 --profile personal    # if `aws sts get-caller-identity` fails
export AWS_PROFILE=personal AWS_REGION=us-west-1 AWS_DEFAULT_REGION=us-west-1   # the desktop defaults to us-west-2
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export HOSTED_ZONE_NAME=ashershores.com
export HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$HOSTED_ZONE_NAME" \
  --max-items 1 --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
export REPO_ID=$(gh api repos/asherShores5/NutriSageAI --jq .id)
echo "zone=$HOSTED_ZONE_ID repo=$REPO_ID"
```

## 2. Bootstrap check (both regions)

Checked 2026-11-02: `CDKToolkit` is `CREATE_COMPLETE`, version 32, in us-west-1 and us-east-1.
Re-check; bootstrap only if one is missing:

```sh
for r in us-west-1 us-east-1; do
  aws cloudformation describe-stacks --region $r --stack-name CDKToolkit \
    --query 'Stacks[0].[StackStatus,Outputs[?OutputKey==`BootstrapVersion`].OutputValue|[0]]' --output text
done
# only if missing:
# (cd infra && npx cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/us-west-1" "aws://$CDK_DEFAULT_ACCOUNT/us-east-1")
```

GitHub OIDC provider: it already exists (Honey Do's CI stack owns it; checked 2026-11-02).
NutriSageCi imports it and never creates one. Check it's still there:

```sh
aws iam list-open-id-connect-providers   # expect .../oidc-provider/token.actions.githubusercontent.com
```

Don't delete Honey Do's CI stack: that would delete the provider and break this deploy role too.

## 3. Pre-flight (no changes)

```sh
npm ci && npm test && npm run typecheck && npm run build:web && npm run synth
(cd infra && npx cdk diff --all -c requireHosting=true -c githubRepoId="$REPO_ID")
```

Expect four new stacks and no `[-]` or `replace` lines. Before the first deploy, also look for any
`nutrisage` record already in the zone (there was none on 2026-11-02):

```sh
aws route53 list-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --query "ResourceRecordSets[?contains(Name,'nutrisage')].[Name,Type]" --output text
```

For later infra changes to existing stacks, make a no-execute change set first and check it for
replacements, then delete it:

```sh
(cd infra && npx cdk deploy NutriSage --no-execute -c requireHosting=true -c githubRepoId="$REPO_ID")
aws cloudformation describe-change-set --stack-name NutriSage --change-set-name <name from the output> \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId,Replacement]' --output text
aws cloudformation delete-change-set --stack-name NutriSage --change-set-name <name>
```

## 4. First deploy (from the dev desktop; it creates the role CI needs)

Asher's go needed. CDK shows the IAM changes and asks before each stack; read them.
`--all` deploys in dependency order: NutriSage, NutriSageCert, NutriSageWeb, NutriSageCi.

```sh
(cd infra && npx cdk deploy --all -c requireHosting=true -c githubRepoId="$REPO_ID" --outputs-file cdk-outputs.json)
```

The certificate waits for DNS validation (a few minutes). `infra/cdk-outputs.json` is gitignored;
it holds `UserPoolId`, `ClientId`, `GraphqlUrl`, `GuestEstimateUrl` (NutriSage), `Url`,
`BucketName`, `DistributionId` (NutriSageWeb) and `DeployRoleArn` (NutriSageCi).

## 5. Anonymous checks (before any user exists)

```sh
(cd infra && npx tsx scripts/check-live.ts cdk-outputs.json)
```

It runs as an anonymous client and prints PASS/FAIL per check; exit 1 means stop:

```
Member API refuses anonymous calls            401 UnauthorizedException
Member API refuses a junk token               401 UnauthorizedException
Self sign-up is off                           400 NotAuthorizedException
Bucket refuses direct reads                   403 from S3 (only CloudFront can read it)
Guest endpoint answers only POST /estimate    404 on other routes; an empty Food gets 400 (no Bedrock call)
Guest endpoint allows only the app's origin   no CORS allow for another site
Site is public with strict security headers   200 with CSP (own API + Guest hosts, no unsafe-*), HSTS, DENY, nosniff
config.json points at this deploy             region, pool, client, API and Guest URLs match the outputs
```

A CloudFront distribution can take a few minutes to answer on the domain; re-run if only the two
site checks fail right after the deploy.

## 6. GitHub settings for CI (Asher, in github.com > repo Settings)

1. Environments > New environment `production`:
   - Deployment branches and tags: Selected branches, add `prod` only.
   - Required reviewers: asherShores5. (Leave "Prevent self-review" off: you're the only reviewer.)
   - Environment secret `AWS_ACCOUNT_ID` = the account ID (a secret so it's masked in public logs).
   - Environment variables `HOSTED_ZONE_ID` and `HOSTED_ZONE_NAME` (`ashershores.com`).
   Or from the terminal (the environment itself is easiest to create in the UI):

   ```sh
   gh secret set AWS_ACCOUNT_ID --env production --body "$CDK_DEFAULT_ACCOUNT"
   gh variable set HOSTED_ZONE_ID --env production --body "$HOSTED_ZONE_ID"
   gh variable set HOSTED_ZONE_NAME --env production --body "$HOSTED_ZONE_NAME"
   ```
2. Branches: create `prod` from `main`. Protect `main` and `prod` (no force pushes, no deletion;
   `main` requires a PR and the `test` check). An unprotected deploy branch is the main risk here.
3. Actions > General: workflow permissions "Read repository contents" (the workflow asks for more
   only in the deploy job).

CI gets the repo ID from GitHub (`GITHUB_REPOSITORY_ID`), so the role's trust policy stays the same
as the first deploy's. GitHub's OIDC subject for this owner is the ID form
(`repo:asherShores5@71547146/<name>@<repo id>:environment:production`; CloudTrail shows it for the
other apps' deploys, no repo setting needed). The role trusts that form for both names (NutriSageAI
now, NutriSage after the rename), pinned to this repo's ID, plus the name-only form for NutriSage
only. So the first deploy (still named NutriSageAI) and every deploy after the rename work, and the
NutriSageAI stub repo created at cutover (a new ID) can never assume the role.

If the first deploy's `configure-aws-credentials` step fails with "Not authorized to perform
sts:AssumeRoleWithWebIdentity", GitHub sent a different subject. Find it in CloudTrail
(`aws cloudtrail lookup-events --region us-west-1 --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity`,
`userIdentity.userName` of the failed event) and stop: don't add the old name's name-only form back.

## 7. Create the Members (only after step 5 passes)

```sh
(cd infra && npx tsx scripts/create-users.ts <UserPoolId>)
```

It creates `asher` and `aubyn` with a 24-character one-time password each, written to
`.secrets/initial-passwords.txt` (chmod 600, gitignored), never to the screen. `--reset` issues new
passwords for existing users. Give Aubyn hers in person or by a private message you then delete.
Delete the file once both of you have added a passkey.

## 8. Face ID test (Asher's iPhone, then Aubyn's)

Passkeys can't be automated, so this is the real test of sign-in:

1. Safari: open https://nutrisage.ashershores.com. Sign in with the username and one-time password
   (switch the sign-in form to password).
2. Profile tab > Passkeys > Add a passkey > Face ID. The count shows "1 passkey on your account."
3. Profile > Sign out. Sign in again with "Sign in with passkey": Face ID, no password.
4. Share > Add to Home Screen. Open NutriSage from the home screen and sign in with the passkey there
   too (the installed app is its own browser context on iOS).
5. Log an Entry, then open the app on another device (or desktop: passkey or phone QR) and see it there.
6. As a Guest (signed out, private tab): estimate one Food. It works and counts toward the daily cap.

If the passkey prompt doesn't appear, check the URL is exactly nutrisage.ashershores.com: the
user pool's passkey relying party is that domain and can't change after creation.

## 9. Deploy from CI

Push `main` (tests only), then fast-forward `prod` to it. The `prod` push runs the tests, then the
deploy job waits in the `production` environment until Asher clicks Review deployments > Approve.
Then confirm the live site serves the bundle you built:

```sh
npm run build:web
ls web/dist/assets/index-*.js
curl -s https://nutrisage.ashershores.com/ | grep -o 'assets/index-[^"]*\.js'
```

Re-run step 5 after any infra change (`--outputs-file` again, or reuse the old file if the
outputs didn't change).

## 10. Later security checks

- AWS Budgets: `nutrisage-monthly` ($2) exists and emails at 80% actual / 100% forecast.
- Cognito > Users: only asher and aubyn. CloudTrail: no `SignUp`/`AdminCreateUser` you didn't run.
- Guest cap table and Lambda logs: Guest usage looks like you, not a script.
- Dependabot PRs monthly; review action SHA bumps before merging.

## Context and env keys (reference)

Context key (`-c key=value`) or env var; context wins. Read by `infra/lib/config.ts` and `infra/bin/app.ts`.

```
account         CDK_DEFAULT_ACCOUNT    the CDK CLI sets the env var from your credentials
hostedZoneId    HOSTED_ZONE_ID         existing public zone
zoneName        HOSTED_ZONE_NAME       nutrisage.ashershores.com must be inside it
githubRepoId    GITHUB_REPOSITORY_ID   numeric; required with hosting; set automatically in GitHub Actions
region          -                      defaults to us-west-1 (AWS_REGION is ignored on purpose)
requireHosting  -                      true makes a missing zone an error (npm run deploy sets it)
```

With no zone set, `npm run synth` builds only the `NutriSage` stack (what the CI test job does).
