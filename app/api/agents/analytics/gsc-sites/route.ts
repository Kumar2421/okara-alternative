import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/domain/analytics/googleAnalyticsData";
import { listSearchConsoleSites } from "@/lib/domain/shared/googleAnalyticsOAuth";

/** Real list of every Search Console site this connected account can see —
 * auto-picking one (even domain-matched) can still be wrong when an
 * account has many properties, so the Traffic tab shows this real list and
 * lets the user pick instead of guessing on their behalf. */
export async function GET() {
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
