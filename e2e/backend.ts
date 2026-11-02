// Fake backend for browser checks (Honey Do's pattern): the real API handler on the in-memory
// table and a stubbed Bedrock, behind a GraphQL executor built from the composed schema/*.graphql, plus just enough
// Cognito for the web app to sign in. Nothing here talks to AWS.
import { buildSchema, defaultFieldResolver, execute, parse, type GraphQLFieldResolver } from "graphql";
import { composeSchemaDir } from "../schema/compose";

export interface Member {
  userId: string;
  username: string;
}

export const MEMBERS: Record<string, Member> = {
  asher: { userId: "sub-asher", username: "asher" },
  aubyn: { userId: "sub-aubyn", username: "aubyn" },
};

// handler.ts reads these at import time, so import it only after setting them.
process.env.TABLE_NAME = "e2e-table";
process.env.ALLOWED_USERNAMES = Object.keys(MEMBERS).join(",");
process.env.MODEL_ID = "e2e-model";
const { handler, setDocClient, setBedrockClient } = await import("../api/src/handler");
const { FakeDocClient } = await import("../api/src/testing/fakeDynamo");
const { FakeBedrock } = await import("../api/src/testing/fakeBedrock");
const { appSyncEvent } = await import("../api/src/testing/harness");
// The Guest estimate endpoint: the real Guest Lambda handler on its own in-memory cap table,
// with a small per-IP cap so a check can reach it.
export const GUEST_IP_CAP = 2;
process.env.GUEST_IP_DAILY_CAP = String(GUEST_IP_CAP);
process.env.GUEST_DAILY_CEILING = "50";
const { guestHarness } = await import("../api/src/testing/guestHarness");
const guest = guestHarness();

export const db = new FakeDocClient();
setDocClient(db);
/** The stubbed model: a check scripts the next estimate with `bedrock.reply(json)` or `bedrock.fail(err)`. */
export const bedrock = new FakeBedrock();
setBedrockClient(bedrock);

// AppSync supplies these scalars; graphql-js needs them declared.
const schema = buildSchema(`scalar AWSJSON\nscalar AWSDate\n${composeSchemaDir()}`);

/** Per-call log, so a check can assert what the app sent. */
export const calls: { member: string; field: string; args: unknown }[] = [];

export function memberForToken(token: string | undefined): Member | undefined {
  const name = token?.startsWith("fake-id.") ? token.slice("fake-id.".length) : undefined;
  return name ? MEMBERS[name] : undefined;
}

export async function graphql(token: string | undefined, query: string, variables: Record<string, unknown> = {}) {
  const member = memberForToken(token);
  if (!member) return { errors: [{ message: "Unauthorized", errorType: "UnauthorizedException" }] };
  const fieldResolver: GraphQLFieldResolver<unknown, unknown> = async (src, args, ctx, info) => {
    const parent = info.parentType.name;
    if (parent !== "Query" && parent !== "Mutation") return defaultFieldResolver(src, args, ctx, info);
    calls.push({ member: member.username, field: info.fieldName, args });
    return handler(appSyncEvent(member, info.fieldName, args as Record<string, unknown>));
  };
  const result = await execute({ schema, document: parse(query), variableValues: variables, fieldResolver });
  return JSON.parse(JSON.stringify(result));
}

/** Every request to the Guest endpoint, so a check can assert what a Guest sent. */
export const guestCalls: { path: string; body: unknown }[] = [];

/** One request to the Guest estimate endpoint, from `ip`. */
export async function guestRequest(method: string, path: string, raw: string | undefined, ip = "203.0.113.50") {
  guestCalls.push({ path, body: raw ? JSON.parse(raw) : undefined });
  return guest.post(undefined, { method, path, raw, ip });
}

/** Forget the Guest caps (a new day). */
export const resetGuestCaps = () => guest.reset();

// ---- Cognito (only the calls web/src/auth.ts makes) -----------------------

export const PASSWORD = "e2e-password";

const tokensFor = (username: string) => ({
  AuthenticationResult: {
    IdToken: `fake-id.${username}`, AccessToken: `fake-access.${username}`,
    RefreshToken: `fake-refresh.${username}`, ExpiresIn: 3600, TokenType: "Bearer",
  },
});

/** The fake relying party: the test origin's host (the real pool uses the app domain). */
export const RP_ID = "nutrisage.test";

/** Passkey credential IDs per Member, as Cognito would hold them. */
const passkeys = new Map<string, string[]>();
const sessions = new Map<string, string>();
const b64url = (s: string) => Buffer.from(s).toString("base64url");
const challenge = () => b64url(crypto.randomUUID());
const memberForAccess = (token: unknown) => {
  const u = String(token ?? "").replace(/^fake-access\./, "");
  return MEMBERS[u] ? u : undefined;
};

/** Start a check with these passkeys on the account (or none). */
export function setPasskeys(username: string, ids: string[]) {
  passkeys.set(username, [...ids]);
}
export const passkeysOf = (username: string) => passkeys.get(username) ?? [];

export function cognito(target: string, body: any): { status: number; json: unknown } {
  const fail = (type: string, message: string) => ({ status: 400, json: { __type: type, message } });
  const wrong = () => fail("NotAuthorizedException", "Incorrect username or password.");
  switch (target) {
    case "InitiateAuth": {
      if (body.AuthFlow === "REFRESH_TOKEN_AUTH") {
        const u = String(body.AuthParameters?.REFRESH_TOKEN ?? "").replace(/^fake-refresh\./, "");
        return MEMBERS[u] ? { status: 200, json: { AuthenticationResult: { ...tokensFor(u).AuthenticationResult, RefreshToken: undefined } } } : fail("NotAuthorizedException", "Invalid Refresh Token");
      }
      const u = body.AuthParameters?.USERNAME;
      if (body.AuthParameters?.PREFERRED_CHALLENGE === "WEB_AUTHN") {
        const ids = MEMBERS[u] ? passkeysOf(u) : [];
        // Like Cognito: no passkey means the other available challenges instead.
        if (!ids.length) return { status: 200, json: { ChallengeName: "SELECT_CHALLENGE", Session: "s-none", AvailableChallenges: ["PASSWORD"] } };
        const session = `s-${crypto.randomUUID()}`;
        sessions.set(session, u);
        const options = { challenge: challenge(), rpId: RP_ID, timeout: 60_000, userVerification: "required", allowCredentials: ids.map((id) => ({ id, type: "public-key" })) };
        return { status: 200, json: { ChallengeName: "WEB_AUTHN", Session: session, ChallengeParameters: { CREDENTIAL_REQUEST_OPTIONS: JSON.stringify(options) } } };
      }
      // preventUserExistenceErrors: an unknown user looks like a wrong password.
      if (!MEMBERS[u] || body.AuthParameters?.PASSWORD !== PASSWORD) return wrong();
      return { status: 200, json: tokensFor(u) };
    }
    case "RespondToAuthChallenge": {
      if (body.ChallengeName !== "WEB_AUTHN") return fail("NotImplemented", `fake Cognito has no ${body.ChallengeName} challenge`);
      const u = sessions.get(body.Session);
      sessions.delete(body.Session);
      const id = JSON.parse(body.ChallengeResponses?.CREDENTIAL ?? "{}").id;
      if (!u || u !== body.ChallengeResponses?.USERNAME || !passkeysOf(u).includes(id)) return fail("NotAuthorizedException", "Passkey not recognized.");
      return { status: 200, json: tokensFor(u) };
    }
    case "StartWebAuthnRegistration": {
      const u = memberForAccess(body.AccessToken);
      if (!u) return fail("NotAuthorizedException", "Invalid Access Token");
      return {
        status: 200,
        json: {
          CredentialCreationOptions: {
            challenge: challenge(), rp: { id: RP_ID, name: "NutriSage" },
            user: { id: b64url(u), name: u, displayName: u },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { residentKey: "required", userVerification: "required" },
            excludeCredentials: passkeysOf(u).map((id) => ({ id, type: "public-key" })),
          },
        },
      };
    }
    case "CompleteWebAuthnRegistration": {
      const u = memberForAccess(body.AccessToken);
      if (!u) return fail("NotAuthorizedException", "Invalid Access Token");
      setPasskeys(u, [...passkeysOf(u), body.Credential.id]);
      return { status: 200, json: {} };
    }
    case "ListWebAuthnCredentials": {
      const u = memberForAccess(body.AccessToken);
      if (!u) return fail("NotAuthorizedException", "Invalid Access Token");
      return { status: 200, json: { Credentials: passkeysOf(u).map((id, i) => ({ CredentialId: id, RelyingPartyId: RP_ID, CreatedAt: 1_800_000_000 + i })) } };
    }
    case "RevokeToken":
      return { status: 200, json: {} };
    default:
      return fail("NotImplemented", `fake Cognito has no ${target}`);
  }
}

// ---- seed data -------------------------------------------------------------

async function as(username: string, field: string, args: Record<string, unknown>) {
  return handler(appSyncEvent(MEMBERS[username], field, args));
}

const n = (carbs: number, protein: number, fat: number, calories: number) => ({ carbs, protein, fat, fiber: 2, sodium: 120, iron: 1, calories });

/** A few Entries, water, weight and goals for asher on `date` (YYYY-MM-DD), so screens aren't empty. */
export async function seed(date: string) {
  await as("asher", "putDay", {
    input: {
      date,
      entries: [
        { id: "s1", meal: "breakfast", name: "Oatmeal with berries", nutrition: n(40, 8, 5, 240), grams: 250 },
        { id: "s2", meal: "lunch", name: "Turkey sandwich", nutrition: n(45, 28, 12, 410) },
        { id: "s3", meal: "dessert", name: "Dark chocolate square", nutrition: n(6, 1, 5, 70) },
      ],
      water: 5,
      weight: 171.4,
    },
  });
  await as("asher", "putGoals", { input: { carbs: 200, protein: 120, fat: 60, fiber: 30, sodium: 2300, iron: 10, calories: 2000, water: 8 } });
}
