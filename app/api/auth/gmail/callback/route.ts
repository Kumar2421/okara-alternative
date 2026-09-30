import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { consumeOAuthState } from "@/lib/domain/integrations/oauthState";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/domain/shared/gmailOAuth";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Self-host only. Hosted Gmail is established by the platform Google sign-in
 * callback, which stores the user's Gmail grant in Supabase Vault. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const redirectUri = `${req.nextUrl.origin}/api/auth/gmail/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    const oauthState = consumeOAuthState(state);
    if (!oauthState) {
      return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("Gmail authorization expired or was already used. Please reconnect.")}`);
    }

    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        `${settingsUrl}?gmail_error=${encodeURIComponent("No refresh token returned — disconnect any prior grant for this app in your Google Account's Security settings, then reconnect.")}`
      );
    }

    const email = await getConnectedEmail(tokens.accessToken);
    const db = getDb();
    upsertSetting(db, "gmail_access_token", tokens.accessToken);
    upsertSetting(db, "gmail_refresh_token", tokens.refreshToken);
    upsertSetting(db, "gmail_token_expiry", String(tokens.expiresAt));
    upsertSetting(db, "gmail_email", email ?? "");

    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(raw)}`);
  }
}
