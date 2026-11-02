// The Member API: one Lambda behind AppSync (Cognito user-pool auth). AppSync proves the token;
// this checks the username is an allowed Member, then dispatches by field name (resolvers/).
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { UserError } from "./errors";
import { RESOLVERS } from "./resolvers";

export { setDocClient } from "./table";

const ALLOWED = (process.env.ALLOWED_USERNAMES ?? "").split(",").filter(Boolean);

export async function handler(event: AppSyncResolverEvent<Record<string, unknown>>) {
  const id = event.identity as AppSyncIdentityCognito | null;
  const username = (id?.claims?.["cognito:username"] ?? id?.username) as string | undefined;
  if (!id?.sub || !username || !ALLOWED.includes(username)) throw new Error("Forbidden");
  const fn = RESOLVERS[event.info.fieldName];
  if (!fn) throw new Error(`no resolver for ${event.info.fieldName}`);
  try {
    return await fn({ userId: id.sub, username }, event.arguments ?? {});
  } catch (e) {
    if (e instanceof UserError) throw new Error(`${e.type}: ${e.message}`);
    console.error(e);
    throw new Error("InternalError");
  }
}
