/** Real Gmail OAuth2 — raw fetch against Google's standard endpoints, no
 * `googleapis` package (matches this codebase's pattern elsewhere: Tavily,
 * Places, PageSpeed are all raw fetch too). Client ID/Secret come from
 * process.env (static app config, not per-project DB data) — GMAIL_CLIENT_ID
 * / GMAIL_CLIENT_SECRET, set via Settings → API Credentials or hand-edited
 * into .env.local. Requires a server restart after either — Node only reads
 * .env.local at process startup. */

const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"];

export type GmailTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export function buildAuthUrl(redirectUri: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID not set — add it in Settings → API Credentials, then restart the server.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // forces a real refresh_token every time, not just on first-ever consent
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
  if (!res.ok) throw new Error(`Gmail token request failed: HTTP ${res.status}`);
  return res.json();
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GmailTokens> {
  const data = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
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
