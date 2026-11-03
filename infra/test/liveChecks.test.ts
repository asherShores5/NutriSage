import { describe, expect, it } from "vitest";
import { type LiveOutputs, type Probe, runLiveChecks } from "../scripts/liveChecks";

const OUT: LiveOutputs = {
  region: "us-west-1",
  siteUrl: "https://nutrisage.example.com",
  graphqlUrl: "https://abc.appsync-api.us-west-1.amazonaws.com/graphql",
  userPoolId: "us-west-1_TEST",
  clientId: "client123",
  guestEstimateUrl: "https://xyz.execute-api.us-west-1.amazonaws.com/",
  bucketName: "nutrisageweb-bucket",
};

const CSP = "default-src 'self'; connect-src 'self' https://abc.appsync-api.us-west-1.amazonaws.com https://cognito-idp.us-west-1.amazonaws.com https://xyz.execute-api.us-west-1.amazonaws.com; frame-ancestors 'none'";
type Reply = { status: number; headers?: Record<string, string>; body?: string };

/** A correctly locked-down deploy, as AWS answers anonymous callers. */
function lockedDown(p: Probe): Reply {
  const url = new URL(p.url);
  if (url.host === "abc.appsync-api.us-west-1.amazonaws.com") {
    return { status: 401, body: '{"errors":[{"errorType":"UnauthorizedException","message":"Valid authorization header not provided."}]}' };
  }
  if (url.host === "cognito-idp.us-west-1.amazonaws.com") {
    return { status: 400, body: '{"__type":"NotAuthorizedException","message":"SignUp is not permitted for this user pool"}' };
  }
  if (url.host.endsWith(".s3.us-west-1.amazonaws.com")) return { status: 403, body: "<Error><Code>AccessDenied</Code></Error>" };
  if (url.host === "xyz.execute-api.us-west-1.amazonaws.com") {
    if (p.method === "OPTIONS") return { status: 204, headers: {} };
    if (p.method === "POST" && url.pathname === "/estimate") return { status: 400, body: '{"error":"ValidationError","message":"Type a Food to estimate"}' };
    return { status: 404, body: '{"message":"Not Found"}' };
  }
  if (url.host === "nutrisage.example.com") {
    const headers = { "content-security-policy": CSP, "strict-transport-security": "max-age=31536000", "x-frame-options": "DENY", "x-content-type-options": "nosniff" };
    if (url.pathname === "/config.json") {
      return { status: 200, headers, body: JSON.stringify({ region: OUT.region, userPoolId: OUT.userPoolId, clientId: OUT.clientId, graphqlUrl: OUT.graphqlUrl, guestEstimateUrl: OUT.guestEstimateUrl }) };
    }
    return { status: 200, headers, body: "<!doctype html><title>NutriSage</title>" };
  }
  throw new Error(`unexpected probe ${p.method} ${p.url}`);
}

const fetcher = (answer: (p: Probe) => Reply) => async (p: Probe) => {
  const r = answer(p);
  return { status: r.status, headers: new Headers(r.headers ?? {}), text: r.body ?? "" };
};
const failed = (results: Awaited<ReturnType<typeof runLiveChecks>>) => results.filter((r) => !r.ok).map((r) => r.name);

describe("post-deploy live checks", () => {
  it("all pass against a locked-down deploy, and never send a credential", async () => {
    const sent: Probe[] = [];
    const results = await runLiveChecks(OUT, fetcher((p) => (sent.push(p), lockedDown(p))));
    expect(failed(results)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
    for (const p of sent) expect(Object.keys(p.headers ?? {}).map((h) => h.toLowerCase())).not.toContain("cookie");
    // The only Authorization ever sent is a junk token, to check the API rejects it.
    expect(sent.filter((p) => p.headers?.Authorization).map((p) => p.headers!.Authorization)).toEqual(["not-a-real-token"]);
  });

  it("fails if the Member API answers an anonymous caller", async () => {
    const results = await runLiveChecks(OUT, fetcher((p) => (p.url === OUT.graphqlUrl ? { status: 200, body: '{"data":{"__typename":"Query"}}' } : lockedDown(p))));
    expect(failed(results)).toEqual(["Member API refuses anonymous calls", "Member API refuses a junk token"]);
  });

  it("fails if self sign-up works, or the bucket is readable without CloudFront", async () => {
    const results = await runLiveChecks(OUT, fetcher((p) => {
      if (p.url.includes("cognito-idp")) return { status: 200, body: '{"UserConfirmed":false}' };
      if (p.url.includes(".s3.")) return { status: 200, body: "<!doctype html>" };
      return lockedDown(p);
    }));
    expect(failed(results)).toEqual(["Self sign-up is off", "Bucket refuses direct reads"]);
  });

  it("fails if the Guest endpoint answers anything but POST /estimate, or allows another site's origin", async () => {
    const results = await runLiveChecks(OUT, fetcher((p) => {
      if (p.url.endsWith("/estimate") && p.method === "GET") return { status: 200, body: "{}" };
      if (p.method === "OPTIONS") return { status: 204, headers: { "access-control-allow-origin": "*" } };
      return lockedDown(p);
    }));
    expect(failed(results)).toEqual(["Guest endpoint answers only POST /estimate", "Guest endpoint allows only the app's origin"]);
  });

  it("fails if the site is missing its security headers or serves config for another endpoint", async () => {
    const results = await runLiveChecks(OUT, fetcher((p) => {
      const r = lockedDown(p);
      if (p.url === `${OUT.siteUrl}/`) return { ...r, headers: {} };
      if (p.url.endsWith("/config.json")) return { ...r, body: JSON.stringify({ guestEstimateUrl: "https://other.example" }) };
      return r;
    }));
    expect(failed(results)).toEqual(["Site is public with strict security headers", "config.json points at this deploy"]);
  });

  it("a network error counts as a failure, not a pass", async () => {
    const results = await runLiveChecks(OUT, async (p) => {
      if (p.url.includes(".s3.")) throw new Error("ECONNRESET");
      return fetcher(lockedDown)(p);
    });
    expect(failed(results)).toEqual(["Bucket refuses direct reads"]);
    expect(results.find((r) => !r.ok)!.detail).toContain("ECONNRESET");
  });
});
