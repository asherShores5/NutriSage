// The Guest estimate endpoint (spec: Guest access): a separate, unauthenticated HTTP API + Lambda
// (api/src/guest.ts). It is public by design: Guests have no sign-in. What keeps it safe:
//   - its role can call Bedrock and UpdateItem on its own cap counter table, and nothing else
//     (no grant at all on the Member table, which holds every Member's Days and the Library);
//   - a per-IP daily cap and a global daily ceiling (counted in that table), checked before Bedrock;
//   - outer limits: this API's throttle, the account's Lambda concurrency cap and the budget.
// A Lambda Function URL isn't an option: an Organizations SCP blocks public Function URLs.
import * as path from "node:path";
import {
  CfnOutput, Duration, RemovalPolicy,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_integrations as integrations,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { allowEstimates } from "./estimate";

/**
 * Guest estimates per IP (IPv6: per /64) per UTC day, and for all Guests together. A Sonnet
 * estimate costs roughly $0.002, so the ceiling bounds Guest spend at about $0.10 a day.
 */
export const GUEST_CAPS = { perIp: 20, ceiling: 50 } as const;

export interface GuestEstimateProps {
  root: string;
  /** Browser origins allowed by CORS (the app's own). */
  allowOrigins: string[];
}

export class GuestEstimate extends Construct {
  readonly url: string;

  constructor(scope: Construct, id: string, props: GuestEstimateProps) {
    super(scope, id);

    // Counters only (hashed network + day, never the IP); TTL clears them after two days.
    const caps = new dynamodb.TableV2(this, "Caps", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new nodejs.NodejsFunction(this, "Fn", {
      entry: path.join(props.root, "api", "src", "guest.ts"),
      projectRoot: props.root,
      depsLockFilePath: path.join(props.root, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // A Bedrock estimate takes a few seconds; the HTTP API gives up on a Lambda at 30 s.
      timeout: Duration.seconds(25),
      environment: {
        CAPS_TABLE: caps.tableName,
        GUEST_IP_DAILY_CAP: String(GUEST_CAPS.perIp),
        GUEST_DAILY_CEILING: String(GUEST_CAPS.ceiling),
      },
      bundling: { minify: true, sourceMap: true, format: nodejs.OutputFormat.ESM, target: "node22" },
      logGroup: new logs.LogGroup(this, "Logs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    // Counting is a conditional UpdateItem inside TransactWriteItems; no reads, no other table.
    caps.grant(fn, "dynamodb:UpdateItem");
    allowEstimates(fn);

    const api = new apigw.HttpApi(this, "Api", {
      apiName: "nutrisage-guest",
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: props.allowOrigins,
        allowMethods: [apigw.CorsHttpMethod.POST],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    api.addRoutes({
      path: "/estimate",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("Estimate", fn),
    });
    const stage = new apigw.HttpStage(this, "Stage", {
      httpApi: api,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 2, burstLimit: 5 },
    });

    this.url = stage.url;
    new CfnOutput(scope, "GuestEstimateUrl", { value: this.url });
  }
}
