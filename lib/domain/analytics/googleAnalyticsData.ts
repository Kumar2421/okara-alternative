import { getDb } from "@/lib/db";
import { refreshAccessToken } from "@/lib/domain/shared/googleAnalyticsOAuth";

/** Same refresh-on-demand pattern as leads/gmailSend.ts's getValidAccessToken —
 * persists the refreshed token back to settings so the next call skips it. */
async function getValidAccessToken(): Promise<string> {
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
