import { getDb } from "@/lib/db";
import { refreshAccessToken } from "@/lib/domain/shared/googleAnalyticsOAuth";

/** Same refresh-on-demand pattern as leads/gmailSend.ts's getValidAccessToken —
 * persists the refreshed token back to settings so the next call skips it. */
export async function getValidAccessToken(): Promise<string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('ga_access_token', 'ga_refresh_token', 'ga_token_expiry')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map.ga_refresh_token) {
    throw new Error("Google Analytics / Search Console isn't connected — connect it in Settings → API Credentials.");
  }

  const expiresAt = Number(map.ga_token_expiry ?? 0);
  if (map.ga_access_token && Date.now() < expiresAt - 60_000) {
    return map.ga_access_token;
  }

  const refreshed = await refreshAccessToken(map.ga_refresh_token);
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "ga_access_token",
    refreshed.accessToken
  );
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "ga_token_expiry",
    String(refreshed.expiresAt)
  );
  return refreshed.accessToken;
}

export type SearchAnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

/** Real Search Console searchAnalytics.query call — https://developers.google.com/webmaster-tools/v1/searchanalytics/query */
export async function fetchSearchAnalytics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 25000
): Promise<SearchAnalyticsRow[]> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Search Console query failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return data.rows ?? [];
}

export type GA4Summary = { sessions: number; activeUsers: number; screenPageViews: number };

/** Real GA4 Data API runReport call — https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport */
export async function fetchGA4Summary(propertyId: string, startDate: string, endDate: string): Promise<GA4Summary> {
  const accessToken = await getValidAccessToken();
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

/** Real daily total-sessions time series — GA4 `date` dimension is
 * "YYYYMMDD" (no separators), reformatted to match GSC's "YYYY-MM-DD" so
 * the Traffic chart can key both series off the same date string. */
export async function fetchGA4DailySessions(propertyId: string, startDate: string, endDate: string): Promise<{ date: string; sessions: number }[]> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GA4 report failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  const rows: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] = data.rows ?? [];
  return rows.map((r) => {
    const raw = r.dimensionValues[0].value; // YYYYMMDD
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return { date, sessions: Number(r.metricValues[0]?.value ?? 0) };
  });
}

/** Real sessions attributed to organic search only (GA4's own default
 * channel grouping) — this is what genuinely maps to "a search result
 * turning into a visit", not overall site traffic. */
export async function fetchGA4OrganicSessions(propertyId: string, startDate: string, endDate: string): Promise<number> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: "sessions" }],
      dimensionFilter: {
        filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search", matchType: "EXACT" } },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GA4 report failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return Number(data.rows?.[0]?.metricValues?.[0]?.value ?? 0);
}
