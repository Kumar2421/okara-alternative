import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
  listSearchConsoleSites,
  pickBestSearchConsoleSite,
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

    const db = getDb();
    const activeId = getActiveProjectId();
    const activeProject = activeId
      ? (db.prepare("SELECT url FROM projects WHERE id = ?").get(activeId) as { url: string } | undefined)
      : undefined;

    const [email, gscSites, ga4Property] = await Promise.all([
      getConnectedEmail(tokens.accessToken),
      listSearchConsoleSites(tokens.accessToken),
      listFirstGA4Property(tokens.accessToken),
    ]);
    // Domain-matched to the active project's own URL, not just "whichever
    // site this account happened to list first" — an account can have many
    // verified sites, and picking blindly means Traffic data for the wrong
    // domain (or a 403 if that other site's permission level doesn't
    // actually allow querying it).
    const gscSite = pickBestSearchConsoleSite(gscSites, activeProject?.url ?? "");

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
