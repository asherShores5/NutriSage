// The Content-Security-Policy CloudFront sends (hosting.ts). Plain string building with no CDK
// imports, so e2e browser checks can serve the very same policy. Hosts are passed in (at deploy
// they are CDK tokens for this app's own AppSync API and Guest endpoint, never a wildcard), so
// injected script couldn't send tokens or food data to an API someone else owns.
export interface CspHosts {
  region: string;
  /** This app's AppSync host (no scheme, no path). */
  graphqlHost: string;
  /** The Guest estimate endpoint's host (no scheme, no path). */
  guestHost: string;
}

export function contentSecurityPolicy({ region, graphqlHost, guestHost }: CspHosts): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // The PWA icons; the Trends chart is a canvas, not images.
    "img-src 'self'",
    `connect-src 'self' https://${graphqlHost} https://cognito-idp.${region}.amazonaws.com https://${guestHost}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}
