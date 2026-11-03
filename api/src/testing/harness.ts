// Seam 2 test harness: call the real Lambda handler as either Member against an in-memory table.
//
//   const h = harness();
//   beforeEach(() => h.reset());
//   await h.call(h.A, "putDay", { input });
//   const days = await h.call(h.B, "days", { from, to });
//   h.bedrock.reply('{"carbs": 1, ...}'); await h.call(h.A, "estimate", { text: "2 eggs" });
//
// handler.ts reads TABLE_NAME / ALLOWED_USERNAMES / MODEL_ID at import time, so tests must import the
// handler through this module (never statically) for the env below to take effect.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { FakeBedrock } from "./fakeBedrock";
import { FakeDocClient } from "./fakeDynamo";

export interface Member {
  userId: string;
  username: string;
}

export const memberA: Member = { userId: "sub-a", username: "member-a" };
export const memberB: Member = { userId: "sub-b", username: "member-b" };

process.env.TABLE_NAME = process.env.TABLE_NAME ?? "test-table";
process.env.ALLOWED_USERNAMES = process.env.ALLOWED_USERNAMES ?? `${memberA.username},${memberB.username}`;
process.env.MODEL_ID = process.env.MODEL_ID ?? "test-model";

const { handler, setDocClient, setBedrockClient } = await import("../handler");
const { QUERY_FIELDS } = await import("../resolvers");

const db = new FakeDocClient();
setDocClient(db);
const bedrock = new FakeBedrock();
setBedrockClient(bedrock);

/** AppSync-shaped resolver event for one Member calling one field. */
export function appSyncEvent(member: Member, fieldName: string, args: Record<string, unknown> = {}) {
  const identity = {
    sub: member.userId,
    username: member.username,
    claims: { sub: member.userId, "cognito:username": member.username },
    issuer: "test", sourceIp: [], defaultAuthStrategy: "ALLOW", groups: null,
  } satisfies AppSyncIdentityCognito;
  return {
    arguments: args,
    identity,
    source: null,
    request: { headers: {}, domainName: null },
    info: { fieldName, parentTypeName: QUERY_FIELDS.has(fieldName) ? "Query" : "Mutation", variables: args, selectionSetList: [], selectionSetGraphQL: "" },
    prev: null,
    stash: {},
  } as AppSyncResolverEvent<Record<string, unknown>>;
}

export function harness() {
  return {
    A: memberA,
    B: memberB,
    db,
    /** The stubbed model: script its reply with `bedrock.reply(text)` or `bedrock.fail(err)`. */
    bedrock,
    /** Empty the table and forget Bedrock calls. */
    reset: () => {
      db.reset();
      bedrock.reset();
    },
    event: appSyncEvent,
    /** Invoke the handler as `member`. Rejects with the same Error the client would see. */
    call: (member: Member, fieldName: string, args: Record<string, unknown> = {}): Promise<any> =>
      handler(appSyncEvent(member, fieldName, args)),
  };
}
