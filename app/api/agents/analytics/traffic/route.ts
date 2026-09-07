import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchSearchAnalytics, fetchGA4Summary } from "@/lib/domain/analytics/googleAnalyticsData";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Real Search Console + GA4 data for the Traffic tab. GSC data lags ~2-3
 * days behind real-time, so the window ends 3 days ago, not today. */
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('gsc_site_url', 'ga_property_id', 'ga_property_name', 'ga_email')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map.ga_email) {
    return NextResponse.json({ error: "Not connected — connect Google Analytics / Search Console in Settings → API Credentials." }, { status: 422 });
  }

  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  let byDate: { date: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  let topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  let totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let gscError: string | null = null;

  if (map.gsc_site_url) {
    try {
      const [dateRows, queryRows] = await Promise.all([
        fetchSearchAnalytics(map.gsc_site_url, startDate, endDate, ["date"]),
        fetchSearchAnalytics(map.gsc_site_url, startDate, endDate, ["query"], 10),
      ]);

      byDate = dateRows.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      topQueries = queryRows
        .sort((a, b) => b.clicks - a.clicks)
        .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

      const totalClicks = byDate.reduce((sum, r) => sum + r.clicks, 0);
      const totalImpressions = byDate.reduce((sum, r) => sum + r.impressions, 0);
      const weightedPosition = byDate.reduce((sum, r) => sum + r.position * r.impressions, 0);
      totals = {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
        position: totalImpressions > 0 ? weightedPosition / totalImpressions : 0,
      };
    } catch (err) {
      gscError = err instanceof Error ? err.message : String(err);
    }
  }

  let ga4: { sessions: number; activeUsers: number; screenPageViews: number } | null = null;
  let ga4Error: string | null = null;
  if (map.ga_property_id) {
    try {
      ga4 = await fetchGA4Summary(map.ga_property_id, startDate, endDate);
    } catch (err) {
      ga4Error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    range: { startDate, endDate },
    site: map.gsc_site_url || null,
    propertyName: map.ga_property_name || null,
    byDate,
    topQueries,
    totals,
    gscError,
    ga4,
    ga4Error,
  });
}
