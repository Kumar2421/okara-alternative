import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/domain/analytics/googleAnalyticsData";
import { listGA4Properties } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/** Same real-picker pattern as gsc-sites — an account can have many GA4
 * properties, so this lists every real one instead of guessing.
 *
 * Platform mode: token comes from integration_connections (provider 'ga4'),
 * refreshed on demand by getValidPlatformGoogleToken(). The *selected*
 * property is the single `external_property` column on that same row
 * (packed "id::name", written by the OAuth callback on connect and by this
 * route's POST on reselect) — not a separate user_settings copy, so there's
 * one source of truth per connection instead of two that can drift apart. */
function parseGA4External(value: string | null | undefined): { id: string; name: string } | null {
  if (!value) return null;
  const [id, name] = value.split("::");
  return id ? { id, name: name ?? "" } : null;
}

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    try {
      const accessToken = await getValidPlatformGoogleToken(db, user.id, "ga4");
      const properties = await listGA4Properties(accessToken);

      const { data: conn } = await db
        .from("integration_connections")
        .select("external_property")
        .eq("user_id", user.id)
        .eq("provider", "ga4")
        .maybeSingle();
      const current = parseGA4External(conn?.external_property);

      return NextResponse.json({ properties, current: current?.id ?? null });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list GA4 properties." }, { status: 500 });
    }
  }

  try {
    const accessToken = await getValidAccessToken();
    const properties = await listGA4Properties(accessToken);
    const db = getDb();
    const current = db.prepare("SELECT value FROM settings WHERE key = 'ga_property_id'").get() as { value: string } | undefined;
    return NextResponse.json({ properties, current: current?.value ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list GA4 properties." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const propertyId: string | undefined = body?.propertyId;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    try {
      const accessToken = await getValidPlatformGoogleToken(db, user.id, "ga4");
      const properties = await listGA4Properties(accessToken);
      const match = properties.find((p) => p.id === propertyId);
      if (!match) {
        return NextResponse.json({ error: "That property isn't in this account's real GA4 property list." }, { status: 400 });
      }

      const { error } = await db
        .from("integration_connections")
        .update({ external_property: `${match.id}::${match.name}`, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("provider", "ga4");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save property." }, { status: 500 });
    }
  }

  try {
    const accessToken = await getValidAccessToken();
    const properties = await listGA4Properties(accessToken);
    const match = properties.find((p) => p.id === propertyId);
    if (!match) {
      return NextResponse.json({ error: "That property isn't in this account's real GA4 property list." }, { status: 400 });
    }

    const db = getDb();
    for (const [key, value] of [
      ["ga_property_id", match.id],
      ["ga_property_name", match.name],
    ]) {
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save property." }, { status: 500 });
  }
}
