import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/domain/shared/googleCloudOAuth";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-cloud/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        `${settingsUrl}?gcp_error=${encodeURIComponent("No refresh token returned — disconnect any prior grant for this app in your Google Account's Security settings, then reconnect.")}`
      );
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
