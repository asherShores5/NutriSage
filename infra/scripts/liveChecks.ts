// Post-deploy release checks (docs/deploy-runbook.md), all made as an anonymous client: verify
// denial, not success. Pure apart from the injected fetcher, so the rules are unit-tested
// (test/liveChecks.test.ts) and check-live.ts runs them for real.

/** The stack outputs the checks need (from cdk-outputs.json). */
export interface LiveOutputs {
  region: string;
  siteUrl: string;
  graphqlUrl: string;
  userPoolId: string;
  clientId: string;
  guestEstimateUrl: string;
  bucketName: string;
}

export interface Probe {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProbeReply {
  status: number;
  headers: Headers;
  text: string;
}

export type Fetcher = (probe: Probe) => Promise<ProbeReply>;

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Check {
  name: string;
  probes: Probe[];
  /** Returns "" when the replies are what a locked-down deploy gives, else what was wrong. */
  verdict: (replies: ProbeReply[]) => string;
}

const EVIL_ORIGIN = "https://not-nutrisage.example";

function checks(o: LiveOutputs): Check[] {
  const guest = o.guestEstimateUrl.replace(/\/$/, "");
  const site = o.siteUrl.replace(/\/$/, "");
  const gql = (headers: Record<string, string>): Probe => ({
    method: "POST",
    url: o.graphqlUrl,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query: "{ __typename }" }),
  });
  const unauthorized = ([r]: ProbeReply[]) =>
    r.status === 401 && r.text.includes("UnauthorizedException") ? "" : `expected 401 UnauthorizedException, got ${r.status} ${r.text.slice(0, 120)}`;

  return [
    { name: "Member API refuses anonymous calls", probes: [gql({})], verdict: unauthorized },
    { name: "Member API refuses a junk token", probes: [gql({ Authorization: "not-a-real-token" })], verdict: unauthorized },
    {
      name: "Self sign-up is off",
      probes: [{
        method: "POST",
        url: `https://cognito-idp.${o.region}.amazonaws.com/`,
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSCognitoIdentityProviderService.SignUp" },
        body: JSON.stringify({ ClientId: o.clientId, Username: "live-check-probe", Password: "Live-Check-Probe-2026" }),
      }],
      verdict: ([r]) => (r.status === 400 && r.text.includes("NotAuthorizedException") ? "" : `expected 400 NotAuthorizedException, got ${r.status} ${r.text.slice(0, 120)}`),
    },
    {
      name: "Bucket refuses direct reads",
      probes: [{ method: "GET", url: `https://${o.bucketName}.s3.${o.region}.amazonaws.com/index.html` }],
      verdict: ([r]) => (r.status === 403 ? "" : `expected 403 from S3, got ${r.status}`),
    },
    {
      name: "Guest endpoint answers only POST /estimate",
      probes: [
        { method: "GET", url: `${guest}/estimate` },
        { method: "GET", url: `${guest}/` },
        { method: "POST", url: `${guest}/pull`, headers: { "content-type": "application/json" }, body: "{}" },
        // An empty Food is refused before the caps or Bedrock, so this costs nothing.
        { method: "POST", url: `${guest}/estimate`, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }) },
      ],
      verdict: (rs) => {
        const wrong = rs.slice(0, 3).filter((r) => r.status !== 404);
        if (wrong.length) return `expected 404 for other routes, got ${wrong.map((r) => r.status).join(", ")}`;
        const est = rs[3];
        return est.status === 400 && est.text.includes("ValidationError") ? "" : `expected POST /estimate to refuse an empty Food with 400, got ${est.status}`;
      },
    },
    {
      name: "Guest endpoint allows only the app's origin",
      probes: [{
        method: "OPTIONS",
        url: `${guest}/estimate`,
        headers: { Origin: EVIL_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      }],
      verdict: ([r]) => {
        const allowed = r.headers.get("access-control-allow-origin");
        return allowed === "*" || allowed === EVIL_ORIGIN ? `another site's origin is allowed (${allowed})` : "";
      },
    },
    {
      name: "Site is public with strict security headers",
      probes: [{ method: "GET", url: `${site}/` }],
      verdict: ([r]) => {
        if (r.status !== 200) return `expected 200, got ${r.status}`;
        const csp = r.headers.get("content-security-policy") ?? "";
        const missing = [
          !csp.includes("frame-ancestors 'none'") && "CSP frame-ancestors",
          !csp.includes(new URL(o.graphqlUrl).host) && "CSP Member API host",
          !csp.includes(new URL(o.guestEstimateUrl).host) && "CSP Guest host",
          csp.includes("unsafe") && "CSP without unsafe-*",
          !r.headers.get("strict-transport-security") && "HSTS",
          r.headers.get("x-frame-options") !== "DENY" && "X-Frame-Options DENY",
          r.headers.get("x-content-type-options") !== "nosniff" && "nosniff",
        ].filter(Boolean);
        return missing.length ? `missing ${missing.join(", ")}` : "";
      },
    },
    {
      name: "config.json points at this deploy",
      probes: [{ method: "GET", url: `${site}/config.json` }],
      verdict: ([r]) => {
        if (r.status !== 200) return `expected 200, got ${r.status}`;
        let c: Record<string, unknown>;
        try {
          c = JSON.parse(r.text);
        } catch {
          return "not JSON";
        }
        const want = { region: o.region, userPoolId: o.userPoolId, clientId: o.clientId, graphqlUrl: o.graphqlUrl, guestEstimateUrl: o.guestEstimateUrl };
        const off = Object.entries(want).filter(([k, v]) => c[k] !== v).map(([k]) => k);
        return off.length ? `wrong ${off.join(", ")}` : "";
      },
    },
  ];
}

export async function runLiveChecks(outputs: LiveOutputs, fetcher: Fetcher): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const c of checks(outputs)) {
    try {
      const replies: ProbeReply[] = [];
      for (const p of c.probes) replies.push(await fetcher(p));
      const problem = c.verdict(replies);
      results.push({ name: c.name, ok: !problem, detail: problem || "ok" });
    } catch (e) {
      results.push({ name: c.name, ok: false, detail: `request failed: ${(e as Error).message}` });
    }
  }
  return results;
}
