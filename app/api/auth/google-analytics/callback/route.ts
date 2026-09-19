import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
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
  const returnUrl = state === "dashboard" ? `${req.nextUrl.origin}/dashboard` : settingsUrl;

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

    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return NextResponse.redirect(`${returnUrl}?ga_error=${encodeURIComponent("Not authenticated")}`);
      const user = authUser;

      const db = createServiceClient();

      const [email, gscSites, ga4Property] = await Promise.all([
        getConnectedEmail(tokens.accessToken),
        listSearchConsoleSites(tokens.accessToken),
        listFirstGA4Property(tokens.accessToken),
      ]);
      // No SQLite `projects` table in platform mode to domain-match against
      // here — account-level connection, pick the best-access site instead.
      const gscSite = pickBestSearchConsoleSite(gscSites, "");
      const ga4External = ga4Property ? `${ga4Property.id}::${ga4Property.name}` : null;

      async function storeConnection(provider: "ga4" | "gsc", externalProperty: string | null) {
        const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
          await Promise.all([
            db.rpc("vault_set_secret", { p_secret: tokens.accessToken, p_name: `${provider}_token:${user.id}:access` }),
            db.rpc("vault_set_secret", { p_secret: tokens.refreshToken!, p_name: `${provider}_token:${user.id}:refresh` }),
          ]);
        if (accessErr || refreshErr) throw new Error(accessErr?.message ?? refreshErr?.message);

        const { error } = await db.from("integration_connections").upsert(
          {
            user_id: user.id,
            project_id: null,
            provider,
            access_token_secret_id: accessSecretId as string,
            refresh_token_secret_id: refreshSecretId as string,
            token_expiry: new Date(tokens.expiresAt).toISOString(),
            external_email: email ?? null,
            external_property: externalProperty,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,project_id,provider" }
        );
        if (error) throw new Error(error.message);
      }

      await Promise.all([storeConnection("ga4", ga4External), storeConnection("gsc", gscSite ?? null)]);

      return NextResponse.redirect(state === "dashboard" ? `${returnUrl}?ga_connected=1` : returnUrl);
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
