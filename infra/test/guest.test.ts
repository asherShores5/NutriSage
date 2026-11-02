// The Guest estimate endpoint's infrastructure (spec: Guest access): a separate, unauthenticated
// HTTP API + Lambda that can call Bedrock and count its caps, and nothing else.
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../lib/app";
import { GUEST_CAPS } from "../lib/guest";
import { APP_DOMAIN } from "../lib/stacks";

let app: Template;
let res: Record<string, any>;
beforeAll(() => {
  app = Template.fromStack(buildApp(new App(), { region: "us-west-1" }).app);
  res = app.toJSON().Resources;
}, 120_000);

const logicalIdOf = (ref: unknown) => {
  const r = ref as { Ref?: string; "Fn::GetAtt"?: [string, string] };
  return r?.Ref ?? r?.["Fn::GetAtt"]?.[0];
};
const guestFn = () => {
  const fns = Object.entries(res).filter(([, r]) => r.Type === "AWS::Lambda::Function" && r.Properties.Environment?.Variables?.CAPS_TABLE);
  expect(fns).toHaveLength(1);
  return fns[0];
};
const memberTableId = () => Object.entries(res).find(([, r]) => r.Type === "AWS::DynamoDB::GlobalTable" && !r.Properties.TimeToLiveSpecification)![0];
const capsTableId = () => logicalIdOf(guestFn()[1].Properties.Environment.Variables.CAPS_TABLE)!;
/** Every IAM statement attached to the Guest Lambda's role. */
const guestStatements = () => {
  const roleId = logicalIdOf(guestFn()[1].Properties.Role);
  const policies = Object.values(res).filter((r) => r.Type === "AWS::IAM::Policy" && r.Properties.Roles.some((x: unknown) => logicalIdOf(x) === roleId));
  const managed = res[roleId!].Properties.ManagedPolicyArns ?? [];
  return { statements: policies.flatMap((p) => p.Properties.PolicyDocument.Statement), managed };
};

describe("Guest estimate Lambda", () => {
  it("knows nothing of the Member table: no TABLE_NAME, its own cap table, the model and both caps", () => {
    const vars = guestFn()[1].Properties.Environment.Variables;
    expect(vars.TABLE_NAME).toBeUndefined();
    expect(vars).toMatchObject({
      MODEL_ID: "us.anthropic.claude-sonnet-4-6",
      GUEST_IP_DAILY_CAP: String(GUEST_CAPS.perIp),
      GUEST_DAILY_CEILING: String(GUEST_CAPS.ceiling),
    });
    expect(capsTableId()).not.toBe(memberTableId());
    expect(JSON.stringify(guestFn()[1])).not.toContain(memberTableId());
  });

  it("IAM: UpdateItem on the cap table only (no reads, no Member table) plus InvokeModel; nothing else but logs", () => {
    const { statements, managed } = guestStatements();
    expect(JSON.stringify(managed)).toMatch(/AWSLambdaBasicExecutionRole/);
    expect(managed).toHaveLength(1);
    const dynamo = statements.filter((s: any) => [s.Action].flat().some((a: string) => a.startsWith("dynamodb:")));
    expect(dynamo).toHaveLength(1);
    expect(dynamo[0].Action).toBe("dynamodb:UpdateItem");
    expect([dynamo[0].Resource].flat().map(logicalIdOf)).toEqual([capsTableId()]);
    expect(JSON.stringify(statements)).not.toContain(memberTableId());
    const actions = statements.flatMap((s: any) => [s.Action].flat()).sort();
    expect(actions).toEqual(["bedrock:InvokeModel", "dynamodb:UpdateItem"]);
  });

  it("times out before the HTTP API gives up (30 s)", () => {
    const p = guestFn()[1].Properties;
    expect(p.Timeout).toBeGreaterThanOrEqual(20);
    expect(p.Timeout).toBeLessThan(30);
  });
});

describe("Guest cap table", () => {
  it("is on demand and forgets counters by TTL", () => {
    expect(res[capsTableId()].Properties).toMatchObject({
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
    });
  });
});

describe("Guest HTTP API", () => {
  it("has one route, POST /estimate, with no authorizer (it is the public Guest endpoint)", () => {
    const routes = Object.values(res).filter((r) => r.Type === "AWS::ApiGatewayV2::Route");
    expect(routes.map((r) => r.Properties.RouteKey)).toEqual(["POST /estimate"]);
    expect(routes[0].Properties.AuthorizationType ?? "NONE").toBe("NONE");
    app.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 0);
  });

  it("lets only the app's origin call it from a browser", () => {
    app.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      ProtocolType: "HTTP",
      CorsConfiguration: Match.objectLike({ AllowOrigins: [`https://${APP_DOMAIN}`], AllowMethods: ["POST"], AllowCredentials: Match.absent() }),
    });
  });

  it("is throttled as an outer limit, below the account's Lambda concurrency", () => {
    const [stage] = Object.values(res).filter((r) => r.Type === "AWS::ApiGatewayV2::Stage");
    const t = stage.Properties.DefaultRouteSettings;
    expect(t.ThrottlingRateLimit).toBeGreaterThan(0);
    expect(t.ThrottlingRateLimit).toBeLessThanOrEqual(5);
    expect(t.ThrottlingBurstLimit).toBeLessThanOrEqual(10);
  });

  it("outputs its URL for the web config", () => {
    expect(Object.keys(app.toJSON().Outputs)).toContain("GuestEstimateUrl");
  });

  it("caps are small enough that a day of Guest use stays cheap", () => {
    expect(GUEST_CAPS.perIp).toBe(20);
    expect(GUEST_CAPS.ceiling).toBeLessThanOrEqual(100);
  });
});
