import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  fetchSearchAnalytics,
  fetchGA4Summary,
  getSelectedGA4Property,
  getSelectedSearchConsoleSite,
} from "@/lib/domain/analytics/googleAnalyticsData";
import { findQueryOpportunities } from "@/lib/domain/analytics/queryOpportunities";
import { attachRankingPages } from "@/lib/domain/analytics/queryPageCorrelation";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "No active project — select or create a project first." }, { status: 422 });
  }

  const siteUrl = getSelectedSearchConsoleSite(projectId);
  const ga4Property = getSelectedGA4Property(projectId);
  if (!siteUrl && !ga4Property) {
    return NextResponse.json({
      error: "Google Analytics / Search Console isn't connected for this project — connect it in Settings → API Credentials.",
    }, { status: 422 });
  }

  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  let byDate: { date: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  let topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  let opportunities: ReturnType<typeof findQueryOpportunities> = [];
  let totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let gscError: string | null = null;

  if (siteUrl) {
    try {
      const [dateRows, queryRows, queryPageRows] = await Promise.all([
        fetchSearchAnalytics(siteUrl, startDate, endDate, ["date"]),
        fetchSearchAnalytics(siteUrl, startDate, endDate, ["query"], 25000),
        fetchSearchAnalytics(siteUrl, startDate, endDate, ["query", "page"]),
      ]);

      byDate = dateRows.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      topQueries = queryRows
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 10)
        .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

      const ranked = findQueryOpportunities(queryRows).map((row) => ({
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        score: Number(row.score.toFixed(2)),
      }));
      opportunities = attachRankingPages(ranked, queryPageRows) as typeof opportunities;

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
  if (ga4Property) {
    try {
      ga4 = await fetchGA4Summary(ga4Property.id, startDate, endDate);
    } catch (err) {
      ga4Error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    range: { startDate, endDate },
    site: siteUrl,
    propertyName: ga4Property?.name ?? null,
    byDate,
    topQueries,
    opportunities,
    totals,
    gscError,
    ga4,
    ga4Error,
  });
}
