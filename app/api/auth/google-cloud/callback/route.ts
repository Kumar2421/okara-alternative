import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { consumeOAuthState } from "@/lib/domain/integrations/oauthState";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/domain/shared/googleCloudOAuth";
import { FEATURES } from "@/lib/features";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export async function GET(req: NextRequest) {
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;
  if (FEATURES.PLATFORM_MODE) {
    return NextResponse.redirect(settingsUrl + "?gcp_error=" + encodeURIComponent("Google Cloud credentials are managed by the hosted platform."));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-cloud/callback`;

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    const oauthState = consumeOAuthState(state);
    if (!oauthState) {
      return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("Google Cloud authorization expired or was already used. Please reconnect.")}`);
    }

    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("No refresh token returned — disconnect any prior grant for this app in your Google Account's Security settings, then reconnect.")}`);
    }

    const email = await getConnectedEmail(tokens.accessToken);
    const db = getDb();
    upsertSetting(db, "gcp_access_token", tokens.accessToken);
    upsertSetting(db, "gcp_refresh_token", tokens.refreshToken);
    upsertSetting(db, "gcp_token_expiry", String(tokens.expiresAt));
    upsertSetting(db, "gcp_email", email ?? "");

    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent(raw)}`);
  }
}
