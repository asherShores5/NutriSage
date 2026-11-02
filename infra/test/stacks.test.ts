import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { composeSchemaDir, rootFields } from "../../schema/compose";
import { buildApp } from "../lib/app";
import { ESTIMATE_MODEL } from "../lib/estimate";
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

describe("Bedrock estimates", () => {
  it("the API Lambda calls the chosen US inference profile, set by MODEL_ID", () => {
    expect(ESTIMATE_MODEL.profileId).toBe("us.anthropic.claude-sonnet-4-6");
    app.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ MODEL_ID: "us.anthropic.claude-sonnet-4-6" }) },
    });
  });

  it("IAM allows only InvokeModel, only on that profile and its model in the US regions it routes to", () => {
    const statements = Object.values(app.findResources("AWS::IAM::Policy"))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: any) => [s.Action].flat().some((a: string) => a.startsWith("bedrock:")));
    expect(statements).toHaveLength(1);
    const [s] = statements;
    expect(s.Effect).toBe("Allow");
    expect(s.Action).toBe("bedrock:InvokeModel");
    const resources = JSON.stringify(s.Resource);
    expect(resources).toContain(":inference-profile/us.anthropic.claude-sonnet-4-6");
    for (const r of ["us-east-1", "us-east-2", "us-west-1", "us-west-2"]) {
      expect(resources).toContain(`arn:aws:bedrock:${r}::foundation-model/anthropic.claude-sonnet-4-6`);
    }
    expect(resources).not.toContain("*");
    expect(s.Resource).toHaveLength(5);
  });

  it("gives the Lambda time for a model call (AppSync waits up to 30 s)", () => {
    const fns = Object.values(app.findResources("AWS::Lambda::Function")).filter((f) => f.Properties.Environment?.Variables?.MODEL_ID);
    expect(fns).toHaveLength(1);
    expect(fns[0].Properties.Timeout).toBeGreaterThanOrEqual(20);
    expect(fns[0].Properties.Timeout).toBeLessThan(30);
  });
});
