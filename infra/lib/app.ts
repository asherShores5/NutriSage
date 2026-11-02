import type { App } from "aws-cdk-lib";
import { AppStack } from "./stacks";

export interface AppOptions {
  region: string;
}

export interface BuiltApp {
  app: AppStack;
}

/**
 * Every stack, wired together. No account ID lives in this repo: the stack takes the account from
 * CDK_DEFAULT_ACCOUNT (the CDK CLI sets it from your credentials) or synths env-agnostic.
 * Ticket 11 adds the Cert (us-east-1), Web and Ci stacks here, with the zone from context/env
 * (see ../games-catalog/infra/lib/config.ts).
 */
export function buildApp(scope: App, opts: AppOptions): BuiltApp {
  const app = new AppStack(scope, "NutriSage", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: opts.region } });
  return { app };
}
