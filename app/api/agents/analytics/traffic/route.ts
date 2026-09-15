import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchSearchAnalytics, fetchGA4DailySessions, fetchGA4OrganicSessions } from "@/lib/domain/analytics/googleAnalyticsData";
import { resolveCountry } from "@/lib/domain/shared/countryCodes";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** null when there's no real baseline to compare against — shown as "—",
 * never a fabricated percentage. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function weightedPosition(rows: { position: number; impressions: number }[]): number {
  const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  if (totalImpressions === 0) return 0;
  return rows.reduce((sum, r) => sum + r.position * r.impressions, 0) / totalImpressions;
}

/**
 * Real Search Console + GA4 data for the Traffic tab — current period vs.
 * the immediately-preceding period of the same length, matching the
 * "How people found you" / "How well you're ranking" funnel shape.
 * GSC data lags ~2-3 days behind real-time, so the window ends 3 days ago.
 */
export async function GET(req: NextRequest) {
  const rangeDays = req.nextUrl.searchParams.get("range") === "30" ? 30 : 7;

  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('gsc_site_url', 'ga_property_id', 'ga_property_name', 'ga_email')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map.ga_email) {
    return NextResponse.json({ error: "Not connected — connect Google Analytics / Search Console in Settings → API Credentials." }, { status: 422 });
  }

  const end = addDays(isoDate(new Date()), -3);
  const start = addDays(end, -(rangeDays - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(rangeDays - 1));

  let byDate: { date: string; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  let topQueries: { query: string; clicks: number; ctr: number }[] = [];
  let topPages: { page: string; clicks: number }[] = [];
  let topCountries: { code: string; name: string; clicks: number; share: number }[] = [];
  let totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let previousTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let gscError: string | null = null;

  if (map.gsc_site_url) {
    try {
      const [dateRows, queryRows, pageRows, countryRows] = await Promise.all([
        fetchSearchAnalytics(map.gsc_site_url, prevStart, end, ["date"]),
        fetchSearchAnalytics(map.gsc_site_url, start, end, ["query"], 10),
        fetchSearchAnalytics(map.gsc_site_url, start, end, ["page"], 10),
        fetchSearchAnalytics(map.gsc_site_url, start, end, ["country"], 5),
      ]);

      const allDates = dateRows.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      byDate = allDates.filter((r) => r.date >= start && r.date <= end);
      const previousDates = allDates.filter((r) => r.date >= prevStart && r.date <= prevEnd);

      const sum = (rs: typeof byDate, key: "clicks" | "impressions") => rs.reduce((s, r) => s + r[key], 0);
      totals = {
        clicks: sum(byDate, "clicks"),
        impressions: sum(byDate, "impressions"),
        ctr: sum(byDate, "impressions") > 0 ? sum(byDate, "clicks") / sum(byDate, "impressions") : 0,
        position: weightedPosition(byDate),
      };
      previousTotals = {
        clicks: sum(previousDates, "clicks"),
        impressions: sum(previousDates, "impressions"),
        ctr: sum(previousDates, "impressions") > 0 ? sum(previousDates, "clicks") / sum(previousDates, "impressions") : 0,
        position: weightedPosition(previousDates),
      };

      topQueries = queryRows.sort((a, b) => b.clicks - a.clicks).map((r) => ({ query: r.keys[0], clicks: r.clicks, ctr: r.ctr }));
      topPages = pageRows.sort((a, b) => b.clicks - a.clicks).map((r) => ({ page: r.keys[0], clicks: r.clicks }));

      const totalCountryClicks = countryRows.reduce((s, r) => s + r.clicks, 0);
      topCountries = countryRows
        .sort((a, b) => b.clicks - a.clicks)
        .map((r) => {
          const { code, name } = resolveCountry(r.keys[0]);
          return { code, name, clicks: r.clicks, share: totalCountryClicks > 0 ? (r.clicks / totalCountryClicks) * 100 : 0 };
        });
    } catch (err) {
      gscError = err instanceof Error ? err.message : String(err);
    }
  }

  let chart: { date: string; clicks: number; sessions: number }[] = [];
  let organicSessions = 0;
  let previousOrganicSessions = 0;
  let ga4Error: string | null = null;

  let ga4Ok = false;
  if (map.ga_property_id) {
    try {
      const [dailySessions, current, previous] = await Promise.all([
        fetchGA4DailySessions(map.ga_property_id, start, end),
        fetchGA4OrganicSessions(map.ga_property_id, start, end),
        fetchGA4OrganicSessions(map.ga_property_id, prevStart, prevEnd),
      ]);
      const sessionsByDate = new Map(dailySessions.map((d) => [d.date, d.sessions]));
      chart = byDate.map((d) => ({ date: d.date, clicks: d.clicks, sessions: sessionsByDate.get(d.date) ?? 0 }));
      organicSessions = current;
      previousOrganicSessions = previous;
      ga4Ok = true;
    } catch (err) {
      ga4Error = err instanceof Error ? err.message : String(err);
      chart = byDate.map((d) => ({ date: d.date, clicks: d.clicks, sessions: 0 }));
    }
  } else {
    chart = byDate.map((d) => ({ date: d.date, clicks: d.clicks, sessions: 0 }));
  }

  const result = {
    range: { startDate: start, endDate: end, days: rangeDays },
    site: map.gsc_site_url || null,
    propertyName: map.ga_property_name || null,
    funnel: {
      impressions: totals.impressions,
      impressionsChange: percentChange(totals.impressions, previousTotals.impressions),
      clicks: totals.clicks,
      clicksChange: percentChange(totals.clicks, previousTotals.clicks),
      organicSessions: ga4Ok ? organicSessions : null,
      organicSessionsChange: ga4Ok ? percentChange(organicSessions, previousOrganicSessions) : null,
      clickRate: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    },
    chart,
    totals: {
      ...totals,
      ctrChange: percentChange(totals.ctr, previousTotals.ctr),
      positionChange: percentChange(totals.position, previousTotals.position),
      clicksChange: percentChange(totals.clicks, previousTotals.clicks),
    },
    topQueries,
    topPages,
    topCountries,
    gscError,
    ga4Error,
  };

  // Cache the real result — the chat agent reads this (see
  // trafficContextPrompt.ts) instead of making its own live Google API
  // calls on every message. Only when we actually have real data worth
  // caching (a site or property configured) — an all-"not connected"
  // response isn't useful context to cache over a previous real one.
  const activeId = getActiveProjectId();
  if (activeId && (map.gsc_site_url || map.ga_property_id)) {
    db.prepare(
      `INSERT INTO traffic_checks (project_id, payload, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`
    ).run(activeId, JSON.stringify(result), new Date().toISOString());
  }

  return NextResponse.json(result);
}
