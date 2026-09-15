import { getDb } from "@/lib/db";

/** Shape written by app/api/agents/analytics/traffic/route.ts — only the
 * fields this block actually reads. */
type CachedTraffic = {
  range: { startDate: string; endDate: string; days: number };
  site: string | null;
  propertyName: string | null;
  funnel: { impressions: number; clicks: number; organicSessions: number | null; clickRate: number };
  totals: { position: number; ctr: number; clicks: number };
  topQueries: { query: string; clicks: number; ctr: number }[];
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Real Traffic tab data for the chat agent — reads the cache written the
 * last time the user opened Analytics → Traffic (see traffic/route.ts),
 * never makes its own live Google API call. Returns null when there's
 * nothing cached yet, so the caller can say so honestly instead of
 * silently omitting context the model might otherwise assume doesn't
 * exist for a reason.
 */
export function buildTrafficContextBlock(projectId: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT payload, checked_at FROM traffic_checks WHERE project_id = ?").get(projectId) as
    | { payload: string; checked_at: string }
    | undefined;
  if (!row) return null;

  const traffic = JSON.parse(row.payload) as CachedTraffic;

  const lines: string[] = [
    `Real Search Console/Analytics data, ${traffic.range.startDate} to ${traffic.range.endDate} (last checked ${row.checked_at.slice(0, 10)} — not live, only as fresh as the last time the Traffic tab was opened):`,
    `- Impressions: ${traffic.funnel.impressions.toLocaleString()}`,
    `- Clicks: ${traffic.funnel.clicks.toLocaleString()} (${fmtPct(traffic.funnel.clickRate)} click rate)`,
    traffic.funnel.organicSessions !== null
      ? `- Organic sessions (real visits from search): ${traffic.funnel.organicSessions.toLocaleString()}`
      : `- Organic sessions: not available (Google Analytics not connected or errored)`,
    `- Average ranking position: #${traffic.totals.position.toFixed(1)}`,
  ];

  if (traffic.topQueries.length > 0) {
    lines.push("- Top real queries bringing traffic:");
    for (const q of traffic.topQueries.slice(0, 5)) {
      lines.push(`  - "${q.query}" — ${q.clicks} clicks, ${fmtPct(q.ctr)} CTR`);
    }
  }

  return lines.join("\n");
}
