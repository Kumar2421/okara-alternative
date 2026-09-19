import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/domain/analytics/googleAnalyticsData";
import { listSearchConsoleSites } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/** Real list of every Search Console site this connected account can see —
 * auto-picking one (even domain-matched) can still be wrong when an
 * account has many properties, so the Traffic tab shows this real list and
 * lets the user pick instead of guessing on their behalf.
 *
 * Platform mode: token comes from integration_connections (provider 'gsc'),
 * refreshed on demand by getValidPlatformGoogleToken(). Selection is that
 * same row's `external_property` column (the site URL directly, written by
 * the OAuth callback on connect and by this route's POST on reselect) —
 * single source of truth, not a separate user_settings copy. */

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    try {
      const accessToken = await getValidPlatformGoogleToken(db, user.id, "gsc");
      const sites = await listSearchConsoleSites(accessToken);

      const { data: conn } = await db
        .from("integration_connections")
        .select("external_property")
        .eq("user_id", user.id)
        .eq("provider", "gsc")
        .maybeSingle();

      return NextResponse.json({ sites, current: conn?.external_property ?? null });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list Search Console sites." }, { status: 500 });
    }
  }

  try {
    const accessToken = await getValidAccessToken();
    const sites = await listSearchConsoleSites(accessToken);
    const db = getDb();
    const current = db.prepare("SELECT value FROM settings WHERE key = 'gsc_site_url'").get() as { value: string } | undefined;
    return NextResponse.json({ sites, current: current?.value ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list Search Console sites." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const siteUrl: string | undefined = body?.siteUrl;
  if (!siteUrl) return NextResponse.json({ error: "siteUrl is required" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    try {
      // Re-verify against the real list rather than trusting an arbitrary
      // client-supplied string — only ever save a site this account can
      // actually see.
      const accessToken = await getValidPlatformGoogleToken(db, user.id, "gsc");
      const sites = await listSearchConsoleSites(accessToken);
      if (!sites.some((s) => s.siteUrl === siteUrl)) {
        return NextResponse.json({ error: "That site isn't in this account's real Search Console site list." }, { status: 400 });
      }

      const { error } = await db
        .from("integration_connections")
        .update({ external_property: siteUrl, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("provider", "gsc");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save site." }, { status: 500 });
    }
  }

  try {
    // Re-verify against the real list rather than trusting an arbitrary
    // client-supplied string — only ever save a site this account can
    // actually see.
    const accessToken = await getValidAccessToken();
    const sites = await listSearchConsoleSites(accessToken);
    if (!sites.some((s) => s.siteUrl === siteUrl)) {
      return NextResponse.json({ error: "That site isn't in this account's real Search Console site list." }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('gsc_site_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      siteUrl
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save site." }, { status: 500 });
  }
}
