// Which Bedrock model the estimate Lambdas call, and the least-privilege grant to call it.
// Used by the Member API Lambda now and by the Guest estimate Lambda (ticket 10).
//
// Checked 2026-11-02: Claude Sonnet 4.6 is the newest Sonnet this account can invoke (Sonnet 5.x
// is listed but its agreement isn't available to the account). Invoked from us-west-1 through the
// US cross-region profile, which routes to the four US regions below. The bare model ID can't be
// invoked on demand, so the Lambda calls the profile. Switching models = change this constant.
import { Stack, aws_iam as iam, aws_lambda as lambda } from "aws-cdk-lib";

export const ESTIMATE_MODEL = {
  modelId: "anthropic.claude-sonnet-4-6",
  profileId: "us.anthropic.claude-sonnet-4-6",
  /** Regions the US profile routes requests to; each needs the foundation-model ARN allowed. */
  routedRegions: ["us-east-1", "us-east-2", "us-west-1", "us-west-2"],
} as const;

/** Set MODEL_ID on `fn` and allow it bedrock:InvokeModel (Converse uses it) on the profile and its model only. */
export function allowEstimates(fn: lambda.Function) {
  const stack = Stack.of(fn);
  fn.addEnvironment("MODEL_ID", ESTIMATE_MODEL.profileId);
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        stack.formatArn({ service: "bedrock", resource: "inference-profile", resourceName: ESTIMATE_MODEL.profileId }),
        ...ESTIMATE_MODEL.routedRegions.map((r) => `arn:aws:bedrock:${r}::foundation-model/${ESTIMATE_MODEL.modelId}`),
      ],
    }),
  );
}
