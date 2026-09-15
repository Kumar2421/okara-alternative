/** Real OAuth2 for programmatic Google Cloud API key creation — same raw-
 * fetch pattern as gmailOAuth.ts/googleAnalyticsOAuth.ts, reuses the same
 * app-level GMAIL_CLIENT_ID/SECRET (one Google Cloud OAuth client, separate
 * consent/scope/token set). cloud-platform is a genuinely broad scope (full
 * Cloud Resource Manager + API Keys access on whatever project the user
 * points it at) — there's no narrower official scope for the API Keys API,
 * so this is disclosed plainly in the Settings card rather than hidden. */

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email"];

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export function buildAuthUrl(redirectUri: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID not set — add it in Settings → API Credentials, then restart the server.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
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
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

export async function getConnectedEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email ?? null;
  } catch {
    return null;
  }
}
