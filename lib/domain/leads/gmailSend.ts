import { getDb } from "@/lib/db";
import { refreshAccessToken } from "@/lib/domain/shared/gmailOAuth";

/** Returns a valid access token, refreshing it first if the stored one has
 * expired (Gmail access tokens are short-lived, ~1hr) — real refresh via the
 * stored refresh_token, persists the new token+expiry back to settings so
 * the next send doesn't need to refresh again. Throws if not connected. */
async function getValidAccessToken(): Promise<string> {
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

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Real Gmail send — RFC 2822 message, base64url-encoded, POSTed to Gmail's
 * real send endpoint. No mock mode: this genuinely sends an email to a real
 * inbox, so callers must only invoke it from an explicit user action. */
export async function sendGmail(to: string, fromEmail: string, subject: string, body: string): Promise<void> {
  const accessToken = await getValidAccessToken();

  const message = [`From: ${fromEmail}`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(message) }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
}
