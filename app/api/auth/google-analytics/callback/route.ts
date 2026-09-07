import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
  listFirstSearchConsoleSite,
  listFirstGA4Property,
} from "@/lib/domain/shared/googleAnalyticsOAuth";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-analytics/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;
  const returnUrl = state === "dashboard" ? `${req.nextUrl.origin}/` : settingsUrl;

  if (!code) {
    return NextResponse.redirect(`${returnUrl}?ga_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        `${returnUrl}?ga_error=${encodeURIComponent("No refresh token returned — disconnect any prior grant for this app in your Google Account's Security settings, then reconnect.")}`
      );
    }

    const [email, gscSite, ga4Property] = await Promise.all([
      getConnectedEmail(tokens.accessToken),
      listFirstSearchConsoleSite(tokens.accessToken),
      listFirstGA4Property(tokens.accessToken),
    ]);

    const db = getDb();
    upsertSetting(db, "ga_access_token", tokens.accessToken);
    upsertSetting(db, "ga_refresh_token", tokens.refreshToken);
    upsertSetting(db, "ga_token_expiry", String(tokens.expiresAt));
    upsertSetting(db, "ga_email", email ?? "");
    // Honest about "found nothing" — empty string, not a fabricated site/property.
    upsertSetting(db, "gsc_site_url", gscSite ?? "");
    upsertSetting(db, "ga_property_id", ga4Property?.id ?? "");
    upsertSetting(db, "ga_property_name", ga4Property?.name ?? "");

    return NextResponse.redirect(state === "dashboard" ? `${returnUrl}?ga_connected=1` : returnUrl);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${returnUrl}?ga_error=${encodeURIComponent(raw)}`);
  }
}
