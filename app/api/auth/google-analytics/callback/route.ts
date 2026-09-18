import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  exchangeCodeForTokens,
  getConnectedEmail,
  listSearchConsoleSites,
  listGA4Properties,
} from "@/lib/domain/shared/googleAnalyticsOAuth";
import {
  replaceIntegrationResources,
  saveIntegrationSecrets,
  upsertProjectIntegration,
} from "@/lib/domain/integrations/integrationStore";
import { consumeOAuthState } from "@/lib/domain/integrations/oauthState";

function redirectUrl(req: NextRequest, returnTo: "dashboard" | "settings", params: Record<string, string>) {
  const base = returnTo === "dashboard" ? req.nextUrl.origin + "/" : req.nextUrl.origin + "/settings/api-credentials";
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const fallback = req.nextUrl.origin + "/settings/api-credentials";

  if (!code || !state) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Invalid Google authorization response."));
  }

  const oauthState = consumeOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(fallback + "?ga_error=" + encodeURIComponent("Google authorization expired or was already used. Please reconnect."));
  }

  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        redirectUrl(req, oauthState.returnTo, {
          ga_error: "No refresh token returned. Disconnect the prior grant in Google Account security, then reconnect.",
        })
      );
    }

    const [email, gscSites, ga4Properties] = await Promise.all([
      getConnectedEmail(tokens.accessToken),
      listSearchConsoleSites(tokens.accessToken),
      listGA4Properties(tokens.accessToken),
    ]);

    const now = new Date().toISOString();
    const gsc = upsertProjectIntegration({
      projectId: oauthState.projectId,
      provider: "google",
      integrationType: "google-search-console",
      accountIdentifier: email,
      connectedAt: now,
    });
    const ga4 = upsertProjectIntegration({
      projectId: oauthState.projectId,
      provider: "google",
      integrationType: "google-analytics",
      accountIdentifier: email,
      connectedAt: now,
    });

    saveIntegrationSecrets(gsc.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    saveIntegrationSecrets(ga4.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    replaceIntegrationResources(
      gsc.id,
      gscSites.map((site) => ({
        resourceType: "search_console_property",
        resourceId: site,
        resourceName: site,
        metadata: {},
      }))
    );
    replaceIntegrationResources(
      ga4.id,
      ga4Properties.map((property) => ({
        resourceType: "ga4_property",
        resourceId: property.id,
        resourceName: property.name,
        metadata: {},
      }))
    );

    const db = getDb();
    for (const key of [
      "ga_access_token",
      "ga_refresh_token",
      "ga_token_expiry",
      "ga_email",
      "gsc_site_url",
      "ga_property_id",
      "ga_property_name",
    ]) {
      db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    }

    return NextResponse.redirect(
      redirectUrl(req, oauthState.returnTo, {
        ga_connected: "1",
        ga_project: oauthState.projectId,
        ga_gsc_count: String(gscSites.length),
        ga_ga4_count: String(ga4Properties.length),
      })
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(redirectUrl(req, oauthState.returnTo, { ga_error: raw }));
  }
}
