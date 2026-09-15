import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/domain/analytics/googleAnalyticsData";
import { listGA4Properties } from "@/lib/domain/shared/googleAnalyticsOAuth";

/** Same real-picker pattern as gsc-sites — an account can have many GA4
 * properties, so this lists every real one instead of guessing. */
export async function GET() {
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
