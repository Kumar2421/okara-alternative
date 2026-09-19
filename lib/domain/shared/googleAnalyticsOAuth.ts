/** Real OAuth2 for GA4 + Search Console — same pattern as gmailOAuth.ts (raw
 * fetch, no `googleapis` package). Reuses the SAME app-level OAuth client
 * (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET) as Gmail — one Google Cloud project
 * can issue one OAuth client covering multiple scopes, so this is a separate
 * consent flow (different scopes, own token set) rather than a second client
 * the user would have to create and paste in again. */

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export function buildAuthUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID not set — add it in Settings → API Credentials, then restart the server.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET not set.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Google token request failed: HTTP ${res.status}`);
  return res.json();
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  const data = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

export async function getConnectedEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email ?? null;
  } catch {
    return null;
  }
}

/** All Search Console properties visible to this Google account. */
export async function listSearchConsoleSites(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const entries: { siteUrl: string }[] = data.siteEntry ?? [];
    return entries.map((entry) => entry.siteUrl).filter(Boolean);
  } catch {
    return [];
  }
}

/** All GA4 properties visible to this Google account. */
export async function listGA4Properties(accessToken: string): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const properties: { id: string; name: string }[] = [];
    for (const account of data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        if (property.property) {
          properties.push({
            id: property.property,
            name: property.displayName ?? property.property,
          });
        }
      }
    }
    return properties;
  } catch {
    return [];
  }
}

/** First GA4 property for this account, or null if none — used only as the
 * initial pick right after OAuth connect; the Traffic tab's picker is the
 * real source of truth after that. */
export async function listFirstGA4Property(accessToken: string): Promise<{ id: string; name: string } | null> {
  const properties = await listGA4Properties(accessToken);
  return properties[0] ? { id: properties[0].id, name: properties[0].name } : null;
}
