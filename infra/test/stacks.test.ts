import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { composeSchemaDir, rootFields } from "../../schema/compose";
import { buildApp } from "../lib/app";
import { USERNAMES } from "../lib/stacks";

// One synth for the whole file: bundling the API Lambda with esbuild is the slow part.
let app: Template;
beforeAll(() => {
  app = Template.fromStack(buildApp(new App(), { region: "us-west-1" }).app);
}, 120_000);

describe("data", () => {
  it("one PK/SK table, on demand, with point-in-time recovery, deletion protection and RETAIN", () => {
    app.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    app.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
        BillingMode: "PAY_PER_REQUEST",
        Replicas: [Match.objectLike({
          DeletionProtectionEnabled: true,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        })],
      }),
    });
  });
});

describe("auth", () => {
  it("only an admin can create Members (no self sign-up), and password sign-in is allowed", () => {
    app.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolTier: "ESSENTIALS",
      Policies: Match.objectLike({ SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(["PASSWORD"]) } }),
    });
  });

  it("a Member can sign in with a passkey for the app domain, with Face ID or another user check required", () => {
    const [pool] = Object.values(app.findResources("AWS::Cognito::UserPool"));
    expect([...pool.Properties.Policies.SignInPolicy.AllowedFirstAuthFactors].sort()).toEqual(["PASSWORD", "WEB_AUTHN"]);
    expect(pool.Properties.WebAuthnRelyingPartyID).toBe("nutrisage.ashershores.com");
    expect(pool.Properties.WebAuthnUserVerification).toBe("required");
  });

  it("the web client signs in through USER_AUTH (password or passkey) and refresh only", () => {
    const [client] = Object.values(app.findResources("AWS::Cognito::UserPoolClient"));
    expect([...client.Properties.ExplicitAuthFlows].sort()).toEqual(["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH"]);
    expect(client.Properties.PreventUserExistenceErrors).toBe("ENABLED");
  });

  it("tokens last an hour and the session (refresh token) a week", () => {
    app.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: 7 * 24 * 60,
    });
  });

  it("the API takes Cognito user-pool tokens only, and the Lambda allowlists the two Members", () => {
    app.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      AuthenticationType: "AMAZON_COGNITO_USER_POOLS",
      AdditionalAuthenticationProviders: Match.absent(),
    });
    app.resourceCountIs("AWS::AppSync::ApiKey", 0);
    expect(USERNAMES).toEqual(["asher", "aubyn"]);
    app.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ ALLOWED_USERNAMES: "asher,aubyn" }) },
    });
  });
});

describe("API", () => {
  it("doesn't describe itself and caps query depth and resolvers per request", () => {
    app.hasResourceProperties("AWS::AppSync::GraphQLApi", { IntrospectionConfig: "DISABLED" });
    const [api] = Object.values(app.findResources("AWS::AppSync::GraphQLApi"));
    expect(api.Properties.QueryDepthLimit).toBeLessThanOrEqual(5);
    expect(api.Properties.ResolverCountLimit).toBeLessThanOrEqual(5);
  });

  it("has a Lambda resolver for every Query and Mutation field in schema/", () => {
    const fields = rootFields(composeSchemaDir());
    const wired = Object.values(app.findResources("AWS::AppSync::Resolver")).map((r) => `${r.Properties.TypeName}.${r.Properties.FieldName}`);
    const expected = [...fields.Query.map((f) => `Query.${f}`), ...fields.Mutation.map((f) => `Mutation.${f}`)];
    expect(wired.sort()).toEqual(expected.sort());
  });
});

describe("public repo hygiene", () => {
  it("synths with no AWS account ID in the template", () => {
    expect(JSON.stringify(app.toJSON())).not.toMatch(/\b\d{12}\b/);
  });
});
