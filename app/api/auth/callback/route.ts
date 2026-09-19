import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import {
  getConnectedEmail,
  listSearchConsoleSites,
  pickBestSearchConsoleSite,
  listFirstGA4Property,
} from "@/lib/domain/shared/googleAnalyticsOAuth";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

/** Platform mode: stashes the Google provider tokens Supabase Auth handed
 * back into Vault, then records two integration_connections rows (ga4 + gsc
 * — the schema's provider enum treats them as distinct connections even
 * though they share the one OAuth grant). Never writes a raw token into a
 * Postgres column — only the vault_set_secret() uuid ever lands in
 * *_secret_id. Account-level (project_id = null): this flow runs at sign-in,
 * before any per-project scoping concept applies here, and the self-host
 * source only ever kept one global settings row anyway. */
async function persistGoogleServiceTokensSupabase(
  userId: string,
  providerToken: string,
  providerRefreshToken: string
) {
  const db = createServiceClient();

  const [email, gscSites, ga4Property] = await Promise.all([
    getConnectedEmail(providerToken),
    listSearchConsoleSites(providerToken),
    listFirstGA4Property(providerToken),
  ]);
  // No project context is available at sign-in time in platform mode (this
  // is an account-level connection) — pick the best-access site rather than
  // domain-matching against a specific project's URL.
  const gscSite = pickBestSearchConsoleSite(gscSites, "");
  // expiresAt isn't reported on the Supabase session — treat as already
  // stale so the first real API call refreshes it rather than trusting a
  // made-up TTL.
  const tokenExpiry = new Date(0).toISOString();

  async function storeConnection(provider: "ga4" | "gsc", externalProperty: string | null) {
    const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
      await Promise.all([
        db.rpc("vault_set_secret", { p_secret: providerToken, p_name: `${provider}_token:${userId}:access` }),
        db.rpc("vault_set_secret", { p_secret: providerRefreshToken, p_name: `${provider}_token:${userId}:refresh` }),
      ]);
    if (accessErr || refreshErr) {
      throw new Error(accessErr?.message ?? refreshErr?.message ?? "Failed to store token in Vault");
    }

    await db.from("integration_connections").upsert(
      {
        user_id: userId,
        project_id: null,
        provider,
        access_token_secret_id: accessSecretId as string,
        refresh_token_secret_id: refreshSecretId as string,
        token_expiry: tokenExpiry,
        external_email: email ?? null,
        external_property: externalProperty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,project_id,provider" }
    );
  }

  // GA4 property id + name both matter but the schema only has one
  // external_property text column — pack both, delimited, rather than drop
  // the display name. Parse back with `.split("::")` wherever this is read.
  const ga4External = ga4Property ? `${ga4Property.id}::${ga4Property.name}` : null;

  await Promise.all([
    storeConnection("ga4", ga4External),
    storeConnection("gsc", gscSite ?? null),
  ]);
}

// Production only: a Google sign-in that requested the GA4/Search Console
// scopes (see app/login/page.tsx) hands back provider_token/
// provider_refresh_token on the session — reuse those as the same ga_*
// settings the manual OAuth flow writes, so AnalyticsPanel/Traffic tab
// need zero changes. Self-host mode never requests these scopes, so
// providerToken is simply absent there and this is a no-op.
async function persistGoogleServiceTokens(providerToken: string, providerRefreshToken: string | undefined) {
  if (!providerRefreshToken) return;

  const db = getDb();
  const activeId = getActiveProjectId();
  const activeProject = activeId
    ? (db.prepare("SELECT url FROM projects WHERE id = ?").get(activeId) as { url: string } | undefined)
    : undefined;

  const [email, gscSites, ga4Property] = await Promise.all([
    getConnectedEmail(providerToken),
    listSearchConsoleSites(providerToken),
    listFirstGA4Property(providerToken),
  ]);
  const gscSite = pickBestSearchConsoleSite(gscSites, activeProject?.url ?? "");

  upsertSetting(db, "ga_access_token", providerToken);
  upsertSetting(db, "ga_refresh_token", providerRefreshToken);
  // Supabase doesn't report the token's expiry — treat as already stale so
  // the first real API call refreshes it via refreshAccessToken() rather
  // than trusting a made-up TTL.
  upsertSetting(db, "ga_token_expiry", "0");
  upsertSetting(db, "ga_email", email ?? "");
  upsertSetting(db, "gsc_site_url", gscSite ?? "");
  upsertSetting(db, "ga_property_id", ga4Property?.id ?? "");
  upsertSetting(db, "ga_property_name", ga4Property?.name ?? "");
}

// Exchanges the OAuth `code` Supabase redirects back with for a session.
// Requires the provider (Google) to actually be enabled in the Supabase
// project's Auth settings — this route alone doesn't grant that.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next");
  const base = request.nextUrl.origin;

  let destination = "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${base}/login?error=auth`);
    }

    if (data.session?.provider_token) {
      try {
        if (FEATURES.PLATFORM_MODE) {
          if (data.session.provider_refresh_token && data.user) {
            await persistGoogleServiceTokensSupabase(
              data.user.id,
              data.session.provider_token,
              data.session.provider_refresh_token
            );
          }
        } else {
          await persistGoogleServiceTokens(data.session.provider_token, data.session.provider_refresh_token ?? undefined);
        }
      } catch (err) {
        // Login itself succeeded — don't fail the whole sign-in over GA/GSC
        // token bookkeeping. User just sees "Connect" still showing next.
        console.error("[auth/callback] Failed to persist Google service tokens:", err);
      }
    }
  }

  if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
    destination = nextParam;
  }

  return NextResponse.redirect(`${base}${destination}`);
}
