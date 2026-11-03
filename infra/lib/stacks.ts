import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
  aws_appsync as appsync,
  aws_budgets as budgets,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import { composeSchemaDir, rootFields } from "../../schema/compose";
import { allowEstimates } from "./estimate";
import { GuestEstimate } from "./guest";

/** Served by the hosting stacks (ticket 11). */
export const APP_DOMAIN = "nutrisage.ashershores.com";
/** The two Members (admin-created). The API Lambda refuses any other username, even with a valid token. */
export const USERNAMES = ["asher", "aubyn"];
/** Budget alerts (the owner's personal address). */
const BUDGET_EMAIL = "asher.shores5@gmail.com";
const ROOT = path.join(__dirname, "..", "..");

/** The composed schema/*.graphql, as a file for AppSync's Definition (see schema/compose.ts). */
function composedSchemaFile(sdl: string) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "nutrisage-schema-")), "schema.graphql");
  writeFileSync(file, sdl);
  return file;
}

/** Data, auth, the Member API, the Guest endpoint and the budget. Hosting: lib/hosting.ts. Deploy CI: lib/ci.ts. */
export class AppStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly api: appsync.GraphqlApi;
  readonly table: dynamodb.TableV2;
  readonly guest: GuestEstimate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // ---- data: one table (api/src/table.ts has the key layout) ----
    const table = (this.table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    }));

    // ---- auth: admin-created Members, no self sign-up ----
    // ESSENTIALS allows the USER_AUTH (choice-based) flow: a password once, then a passkey (Face ID
    // on iPhone; iCloud Keychain or phone QR on desktop). The password stays as the backup.
    // The relying party is the app domain, so passkeys only work there (ticket 11 serves it).
    const userPool = (this.userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "nutrisage",
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: { allowedFirstAuthFactors: { password: true, passkey: true } },
      passkeyRelyingPartyId: APP_DOMAIN,
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      passwordPolicy: { minLength: 16, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    }));
    this.client = userPool.addClient("Web", {
      authFlows: { user: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      // No hosted UI or OAuth redirects: the app talks to Cognito's JSON API directly.
      disableOAuth: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      // The session lasts a week (spec), then the Member signs in again.
      refreshTokenValidity: Duration.days(7),
    });

    // ---- Member API: AppSync + one Lambda ----
    const fn = new nodejs.NodejsFunction(this, "ApiFn", {
      entry: path.join(ROOT, "api", "src", "handler.ts"),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // A Bedrock estimate takes a few seconds; AppSync gives up on a Lambda at 30 s.
      timeout: Duration.seconds(25),
      environment: { TABLE_NAME: table.tableName, ALLOWED_USERNAMES: USERNAMES.join(",") },
      bundling: { minify: true, sourceMap: true, format: nodejs.OutputFormat.ESM, target: "node22" },
      logGroup: new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    // Only what the resolvers send (Get/Put/Update/Delete/Query; deleteFood's transaction is Deletes),
    // not grantReadWriteData's Scan, Batch* and the rest.
    table.grant(fn, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query");
    allowEstimates(fn);

    const sdl = composeSchemaDir();
    const api = (this.api = new appsync.GraphqlApi(this, "Api", {
      name: "nutrisage",
      definition: appsync.Definition.fromFile(composedSchemaFile(sdl)),
      authorizationConfig: {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.USER_POOL, userPoolConfig: { userPool } },
      },
      // Errors only, without request/response content (food names, weights).
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR, excludeVerboseContent: true, retention: logs.RetentionDays.TWO_WEEKS },
      // The app knows its schema. Every app request is one root field a few levels deep
      // (days > entries > nutrition), so these caps never bite the app.
      introspectionConfig: appsync.IntrospectionConfig.DISABLED,
      queryDepthLimit: 4,
      resolverCountLimit: 2,
    }));

    // Every Query and Mutation field goes to the Lambda, which dispatches by field name
    // (api/src/resolvers). A new field needs no change here.
    const ds = api.addLambdaDataSource("ApiDs", fn);
    const fields = rootFields(sdl);
    for (const typeName of ["Query", "Mutation"] as const) {
      for (const fieldName of fields[typeName]) ds.createResolver(`${typeName[0]}${fieldName}`, { typeName, fieldName });
    }

    // ---- Guest estimates: a separate public endpoint with no access to the table above ----
    this.guest = new GuestEstimate(this, "GuestEstimate", { root: ROOT, allowOrigins: [`https://${APP_DOMAIN}`] });

    // ---- cost tripwire: $2/month (Asher, 2026-11-02) on the app=nutrisage tag (lib/app.ts) ----
    const alert = (notificationType: string, threshold: number) => ({
      notification: { notificationType, comparisonOperator: "GREATER_THAN", threshold },
      subscribers: [{ subscriptionType: "EMAIL", address: BUDGET_EMAIL }],
    });
    new budgets.CfnBudget(this, "Budget", {
      budget: {
        budgetName: "nutrisage-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 2, unit: "USD" },
        costFilters: { TagKeyValue: ["user:app$nutrisage"] },
      },
      notificationsWithSubscribers: [alert("ACTUAL", 80), alert("FORECASTED", 100)],
    });

    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "ClientId", { value: this.client.userPoolClientId });
    new CfnOutput(this, "GraphqlUrl", { value: api.graphqlUrl });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
