// Seam 2 harness for the Guest estimate endpoint: call the real Guest Lambda handler with
// HTTP API (v2) events from a chosen IP, against an in-memory cap counter table.
//
//   const g = guestHarness();
//   beforeEach(() => g.reset());
//   const r = await g.post({ text: "2 eggs" }, { ip: "203.0.113.7" });
//
// Bedrock is not touched here: use harness().bedrock (same estimate module) or e2e's stub.
// guest.ts reads CAPS_TABLE / GUEST_* / MODEL_ID at import time, so import it only through here.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { FakeDocClient } from "./fakeDynamo";

/** Small caps so tests reach them quickly. */
export const TEST_CAPS = { perIp: 3, ceiling: 5 };

process.env.CAPS_TABLE = process.env.CAPS_TABLE ?? "test-guest-caps";
process.env.GUEST_IP_DAILY_CAP = process.env.GUEST_IP_DAILY_CAP ?? String(TEST_CAPS.perIp);
process.env.GUEST_DAILY_CEILING = process.env.GUEST_DAILY_CEILING ?? String(TEST_CAPS.ceiling);
process.env.MODEL_ID = process.env.MODEL_ID ?? "test-model";

const guest = await import("../guest");

export interface GuestRequest {
  ip?: string;
  method?: string;
  path?: string;
  /** Raw body string; overrides `body`. */
  raw?: string;
  /** The time of the request (default now). */
  now?: Date;
}

export function guestEvent(body: unknown, req: GuestRequest = {}): APIGatewayProxyEventV2 {
  const method = req.method ?? "POST";
  const path = req.path ?? "/estimate";
  const now = req.now ?? new Date();
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    body: req.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    isBase64Encoded: false,
    requestContext: {
      accountId: "test", apiId: "test", domainName: "guest.test", domainPrefix: "guest",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: req.ip ?? "203.0.113.1", userAgent: "test" },
      requestId: "r", routeKey: "$default", stage: "$default", time: now.toISOString(), timeEpoch: now.getTime(),
    },
  };
}

export function guestHarness() {
  const caps = new FakeDocClient();
  /** Every table name the Guest Lambda sent a command for. */
  const tables: string[] = [];
  guest.setCapsClient({
    send: (cmd: any) => {
      const input = cmd?.input ?? {};
      if (input.TableName) tables.push(input.TableName);
      for (const t of input.TransactItems ?? []) for (const a of Object.values(t) as { TableName?: string }[]) if (a?.TableName) tables.push(a.TableName);
      return caps.send(cmd);
    },
  } as never);
  return {
    /** The cap counter table (the only table the Guest Lambda can touch). */
    caps,
    tables,
    reset: () => {
      caps.reset();
      tables.length = 0;
    },
    event: guestEvent,
    /** POST a JSON body to the Guest endpoint; the parsed reply. */
    async post(body: unknown, req: GuestRequest = {}) {
      const r = (await guest.handler(guestEvent(body, req))) as APIGatewayProxyStructuredResultV2;
      return { status: r.statusCode ?? 200, body: r.body ? JSON.parse(r.body) : undefined, headers: r.headers ?? {} };
    },
  };
}
