// The Guest estimate endpoint: one unauthenticated Lambda behind an HTTP API (spec: Guest access).
// Anyone can call it, so it is deliberately tiny: it estimates a Food through the shared core in
// ./estimate and nothing else. It never imports ./table or ./resolvers, and its IAM role has no
// access to the Member table (only UpdateItem on its own cap counter table), so a Guest can't
// reach Member or Library data.
//
// Caps (spec: per-IP daily cap + global daily ceiling) are counted in UTC days, in the separate
// CAPS_TABLE. A refused request never reaches Bedrock.
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { cleanFoodText, estimateFood, readPortion } from "./estimate";
import { UserError, invalid } from "./errors";

export { setBedrockClient } from "./estimate";

const CAPS_TABLE = process.env.CAPS_TABLE!;
const PER_IP = Number(process.env.GUEST_IP_DAILY_CAP);
const CEILING = Number(process.env.GUEST_DAILY_CEILING);

type Reply = APIGatewayProxyStructuredResultV2;
type DocClient = Pick<DynamoDBDocumentClient, "send">;

let caps: DocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Test seam: swap the cap counter client (see testing/guestHarness.ts). Production never calls this. */
export function setCapsClient(c: DocClient) {
  caps = c;
}

const json = (statusCode: number, body: unknown): Reply => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

/**
 * Who a Guest is, for the per-IP cap: an IPv4 address, or the /64 prefix of an IPv6 address (one
 * device or home network can rotate through a whole /64).
 */
export function guestNetwork(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const DAY_SECONDS = 86_400;

const LIMIT_IP = `Guest estimates are limited to ${PER_IP} a day. Sign in for more, or type the nutrition by hand.`;
const LIMIT_ALL = "Guest estimates are used up for today. Try again tomorrow, sign in, or type the nutrition by hand.";

/** One counter's increment, refused once it reaches `cap`. */
function bump(day: string, sk: string, cap: number, expiresAt: number) {
  return {
    Update: {
      TableName: CAPS_TABLE,
      Key: { PK: `DAY#${day}`, SK: sk },
      UpdateExpression: "SET #n = if_not_exists(#n,:zero) + :one, expiresAt = :exp",
      ConditionExpression: "attribute_not_exists(#n) OR #n < :cap",
      ExpressionAttributeNames: { "#n": "count" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":cap": cap, ":exp": expiresAt },
    },
  };
}

/**
 * Count one Guest estimate for `ip` today, or throw LimitReached. The per-IP counter and the day's
 * total go up together or not at all, so a refused request uses neither.
 */
async function takeEstimate(ip: string, now: Date) {
  // Fail closed: without both caps configured, no Guest estimate runs.
  if (!(PER_IP > 0 && CEILING > 0)) throw new Error("Guest caps are not configured");
  const day = now.toISOString().slice(0, 10);
  // Not the IP itself: a hash of the day and the network. Rows expire 2 days after the day starts.
  const who = createHash("sha256").update(`${day}|${guestNetwork(ip)}`).digest("hex").slice(0, 32);
  const expiresAt = Date.parse(`${day}T00:00:00Z`) / 1000 + 2 * DAY_SECONDS;
  try {
    await caps.send(new TransactWriteCommand({ TransactItems: [bump(day, `GUEST#${who}`, PER_IP, expiresAt), bump(day, "ALL", CEILING, expiresAt)] }));
  } catch (e) {
    if ((e as Error)?.name !== "TransactionCanceledException") throw e;
    const [ipCode, allCode] = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r?.Code);
    if (ipCode === "ConditionalCheckFailed") throw new LimitReached(LIMIT_IP);
    if (allCode === "ConditionalCheckFailed") throw new LimitReached(LIMIT_ALL);
    throw e; // e.g. a TransactionConflict from two estimates at once: Unavailable, try again
  }
}

class LimitReached extends Error {}

/** Bigger request bodies are refused: a Food is at most a few hundred characters. */
export const MAX_BODY_BYTES = 2048;

/** The request body as a JSON object, or a 400/413 reply. */
function readBody(event: APIGatewayProxyEventV2): { body: Record<string, unknown> } | { reply: Reply } {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { reply: json(413, { error: "ValidationError", message: "That request is too big" }) };
  try {
    const body: unknown = JSON.parse(raw || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return { body: body as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { reply: json(400, { error: "ValidationError", message: "Send a JSON object" }) };
}

/** POST /estimate {text, ingredient?, amount?, unit?} -> an Estimate. Everything else is 404. */
export async function handler(event: APIGatewayProxyEventV2): Promise<Reply> {
  const { method, path, sourceIp } = event.requestContext.http;
  if (method !== "POST" || path !== "/estimate") return json(404, { error: "NotFound", message: "Not found" });
  const read = readBody(event);
  if ("reply" in read) return read.reply;
  const { body } = read;
  try {
    // Checked before counting, so an empty Food doesn't use one of the day's estimates.
    if (!cleanFoodText(body.text)) throw invalid("Type a Food to estimate");
    const portion = readPortion(body.amount, body.unit);
    await takeEstimate(sourceIp, new Date(event.requestContext.timeEpoch));
    return json(200, await estimateFood(body.text, { ingredient: body.ingredient === true, portion }));
  } catch (e) {
    if (e instanceof LimitReached) return json(429, { error: "LimitReached", message: e.message });
    if (e instanceof UserError) return json(e.type === "Unavailable" ? 503 : 400, { error: e.type, message: e.message });
    console.error(`Guest estimate failed: ${(e as Error)?.name ?? "Error"}`);
    return json(503, { error: "Unavailable", message: "Couldn't estimate that right now. Try again, or type the nutrition by hand." });
  }
}
