/** Real Gmail OAuth2 — raw fetch against Google's standard endpoints, no
 * `googleapis` package (matches this codebase's pattern elsewhere: Tavily,
 * Places, PageSpeed are all raw fetch too). Client ID/Secret come from
 * process.env (static app config, not per-project DB data) — GMAIL_CLIENT_ID
 * / GMAIL_CLIENT_SECRET, set via Settings → API Credentials or hand-edited
 * into .env.local. Requires a server restart after either — Node only reads
 * .env.local at process startup.
 *
 * gmail.readonly was added for the reply-tracking phase (lib/domain/leads/
 * gmailInbox.ts) — anyone who connected before this scope existed is still
 * only authorized for gmail.send, so a reply-check call will get a real 403
 * from Google until they click "Connect Gmail" again (prompt=consent below
 * always re-grants both scopes fresh, no separate migration needed). */

import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export type GmailTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export function buildAuthUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID not set — add it in Settings → API Credentials, then restart the server.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // forces a real refresh_token every time, not just on first-ever consent
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

/** Shared by gmailSend.ts and gmailInbox.ts — refreshes the stored access
 * token if it's within 60s of expiry, persists the refreshed token back to
 * settings so the next call skips the refresh. Throws if not connected. */
export async function getValidGmailAccessToken(): Promise<string> {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated.");

    const db = createServiceClient();
    const { data: conn } = await db
      .from("integration_connections")
      .select("id, access_token_secret_id, refresh_token_secret_id, token_expiry")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .is("project_id", null)
      .maybeSingle();

    if (!conn?.refresh_token_secret_id) {
      throw new Error("Gmail isn't connected — connect it with Google sign-in.");
    }

    const [{ data: accessToken }, { data: refreshToken }] = await Promise.all([
      conn.access_token_secret_id
        ? db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id })
        : Promise.resolve({ data: null }),
      db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id }),
    ]);

    if (!refreshToken) throw new Error("Gmail connection is missing its refresh token. Reconnect with Google.");

    const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
    if (accessToken && Date.now() < expiresAt - 60_000) {
      return accessToken as string;
    }

    const refreshed = await refreshAccessToken(refreshToken as string);
    const { data: newAccessSecretId, error } = await db.rpc("vault_set_secret", {
      p_secret: refreshed.accessToken,
      p_name: `gmail_token:${user.id}:access`,
    });
    if (error) throw new Error(error.message);

    const { error: updateError } = await db
      .from("integration_connections")
      .update({
        access_token_secret_id: newAccessSecretId as string,
        token_expiry: new Date(refreshed.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id)
      .eq("user_id", user.id);
    if (updateError) throw new Error(updateError.message);

    return refreshed.accessToken;
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('gmail_access_token', 'gmail_refresh_token', 'gmail_token_expiry')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map.gmail_refresh_token) {
    throw new Error("Gmail isn't connected — connect it in Settings → API Credentials.");
  }

  const expiresAt = Number(map.gmail_token_expiry ?? 0);
  if (map.gmail_access_token && Date.now() < expiresAt - 60_000) {
    return map.gmail_access_token;
  }

  const refreshed = await refreshAccessToken(map.gmail_refresh_token);
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "gmail_access_token",
    refreshed.accessToken
  );
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "gmail_token_expiry",
    String(refreshed.expiresAt)
  );
  return refreshed.accessToken;
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
