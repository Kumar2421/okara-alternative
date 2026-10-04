import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getDb } from "@/lib/db";
import {
  fetchSearchAnalytics,
  fetchGA4Summary,
  getSelectedGA4Property,
  getSelectedSearchConsoleSite,
} from "@/lib/domain/analytics/googleAnalyticsData";
import {
  getSelectedGA4Property as getSelectedGA4PropertySupabase,
  getSelectedSearchConsoleSite as getSelectedSearchConsoleSiteSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { findQueryOpportunities } from "@/lib/domain/analytics/queryOpportunities";
import { attachRankingPages } from "@/lib/domain/analytics/queryPageCorrelation";
import { fetchSearchAnalyticsWithToken } from "@/lib/domain/search/searchConsoleClient";
import { buildSearchInsights } from "@/lib/domain/search/searchInsights";
import { brandTermsFrom } from "@/lib/domain/search/searchIntent";
import type { SearchInsights } from "@/lib/domain/search/types";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ---------- Platform-mode GA4 call ----------
 * googleAnalyticsData.ts's fetch* helpers pull the access token from the
 * self-host integration store internally, so they can't be reused for a
 * Supabase-vault token. Same real GA4 Data API call, parameterized on an
 * explicit access token decrypted from Vault. (The Search Console
 * equivalent lives in lib/domain/search/searchConsoleClient.ts.) */

async function fetchGA4SummaryPlatform(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GA4 report failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  const values: string[] = data.rows?.[0]?.metricValues?.map((m: { value: string }) => m.value) ?? ["0", "0", "0"];
  return { sessions: Number(values[0] ?? 0), activeUsers: Number(values[1] ?? 0), screenPageViews: Number(values[2] ?? 0) };
}

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value;
    if (!projectId) {
      return NextResponse.json({ error: "No active project — select or create a project first." }, { status: 422 });
    }

    const siteUrl = await getSelectedSearchConsoleSiteSupabase(db, user.id, projectId);
    const ga4Property = await getSelectedGA4PropertySupabase(db, user.id, projectId);
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
    let search: SearchInsights | null = null;
    let gscError: string | null = null;

    if (siteUrl) {
      try {
        const accessToken = await getValidPlatformGoogleToken(db, user.id, projectId);
        const [dateRows, queryRows, queryPageRows] = await Promise.all([
          fetchSearchAnalyticsWithToken(accessToken, siteUrl, startDate, endDate, ["date"]),
          fetchSearchAnalyticsWithToken(accessToken, siteUrl, startDate, endDate, ["query"], 25000),
          fetchSearchAnalyticsWithToken(accessToken, siteUrl, startDate, endDate, ["query", "page"]),
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

        const { data: project } = await db.from("projects").select("name, url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
        search = buildSearchInsights(queryRows, brandTermsFrom(project?.name, project?.url));

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
        const accessToken = await getValidPlatformGoogleToken(db, user.id, projectId);
        ga4 = await fetchGA4SummaryPlatform(accessToken, ga4Property.id, startDate, endDate);
      } catch (err) {
        ga4Error = err instanceof Error ? err.message : String(err);
      }
    }

    const result = {
      range: { startDate, endDate },
      site: siteUrl,
      propertyName: ga4Property?.name ?? null,
      byDate,
      topQueries,
      opportunities,
      search,
      totals,
      gscError,
      ga4,
      ga4Error,
    };

    // Cache the real result, same reasoning as self-host: the chat agent
    // reads this cached row instead of making its own live Google API calls
    // on every message.
    await db.from("traffic_checks").upsert(
      { user_id: user.id, project_id: projectId, payload: result, checked_at: new Date().toISOString() },
      { onConflict: "project_id" }
    );

    return NextResponse.json(result);
  }

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
  let search: SearchInsights | null = null;
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

      const project = getDb().prepare("SELECT name, url FROM projects WHERE id = ?").get(projectId) as { name: string; url: string } | undefined;
      search = buildSearchInsights(queryRows, brandTermsFrom(project?.name, project?.url));

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
    search,
    totals,
    gscError,
    ga4,
    ga4Error,
  });
}
