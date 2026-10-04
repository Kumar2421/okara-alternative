import { findQueryOpportunities } from "../analytics/queryOpportunities.ts";
import { compareWindows, summarizeChanges, type ChangeSummary, type QueryChange } from "./searchDelta.ts";
import type { SearchSnapshotPayload, SnapshotQuery } from "./searchSnapshot.ts";

export type OpportunityType = "ranking" | "ctr" | "declining" | "new_query" | "lost_query";

export type OpportunityMetrics = { clicks: number; impressions: number; ctr: number; position: number };

export type SearchOpportunity = {
  type: OpportunityType;
  query: string;
  /** The page that currently ranks for this query, when one is known. */
  pageUrl: string | null;
  /** Prioritisation heuristic within a type; not a traffic forecast. */
  score: number;
  /** Plain-language explanation of why this was flagged. */
  reasons: string[];
  metrics: OpportunityMetrics;
  previous: OpportunityMetrics | null;
};

export type OpportunityGroups = {
  ranking: SearchOpportunity[];
  ctr: SearchOpportunity[];
  declining: SearchOpportunity[];
  newQueries: SearchOpportunity[];
  lostQueries: SearchOpportunity[];
  changes: ChangeSummary;
};

const MAX_PER_GROUP = 5;
const MAX_RANKING = 8;

const CTR_MIN_VIEWS = 100;
const CTR_MAX_POSITION = 3.9;
/** A result is a "snippet" opportunity when it earns under half the typical click rate for its position. */
const CTR_SHORTFALL_RATIO = 0.5;

/** Rough, conservative click rate for organic results at a given position. */
export function expectedCtr(position: number): number {
  if (position < 1.5) return 0.3;
  if (position < 2.5) return 0.16;
  if (position < 3.5) return 0.1;
  return 0.07;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function metricsOf(q: SnapshotQuery): OpportunityMetrics {
  return { clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position };
}

type WithPages = SnapshotQuery & { rankingPages?: Array<{ url: string }> };

function topPage(q: WithPages | null | undefined): string | null {
  return q?.rankingPages?.[0]?.url ?? null;
}

function rank(items: SearchOpportunity[], limit: number): SearchOpportunity[] {
  return [...items]
    .sort((a, b) => b.score - a.score || b.metrics.impressions - a.metrics.impressions || a.query.localeCompare(b.query))
    .slice(0, limit);
}

function rankingOpportunities(current: WithPages[]): SearchOpportunity[] {
  // Delegates to the existing, tested scoring so "ranking" stays identical to the live Traffic tab.
  const scored = findQueryOpportunities(current.map((q) => ({ keys: [q.query], ...metricsOf(q) })));
  const byQuery = new Map(current.map((q) => [q.query, q]));
  return scored.map((s) => {
    const source = byQuery.get(s.query);
    const page = topPage(source);
    return {
      type: "ranking" as const,
      query: s.query,
      pageUrl: page,
      score: Number(s.score.toFixed(2)),
      reasons: [
        `${formatNumber(s.impressions)} people saw you for this search`,
        `You average position ${s.position.toFixed(1)}, just below the top results`,
        `Only ${percent(s.ctr)} of them clicked`,
        page ? "A page on your site already ranks for it, so improving that page is the fastest win" : "No ranking page was recorded for it",
      ],
      metrics: { clicks: s.clicks, impressions: s.impressions, ctr: s.ctr, position: s.position },
      previous: null,
    };
  });
}

function ctrOpportunities(current: WithPages[]): SearchOpportunity[] {
  const found: SearchOpportunity[] = [];
  for (const q of current) {
    if (q.impressions < CTR_MIN_VIEWS || q.position > CTR_MAX_POSITION) continue;
    const expected = expectedCtr(q.position);
    if (q.ctr >= expected * CTR_SHORTFALL_RATIO) continue;
    found.push({
      type: "ctr",
      query: q.query,
      pageUrl: topPage(q),
      score: Number((q.impressions * (expected - q.ctr)).toFixed(2)),
      reasons: [
        `You rank near the top (position ${q.position.toFixed(1)}) with ${formatNumber(q.impressions)} views`,
        `Only ${percent(q.ctr)} click, where about ${percent(expected)} is typical at that position`,
        "A clearer, more compelling title and description should win more of those clicks",
      ],
      metrics: metricsOf(q),
      previous: null,
    });
  }
  return found;
}

function decliningOpportunities(changes: QueryChange[]): SearchOpportunity[] {
  return changes
    .filter((c) => c.trend === "down" && c.current && c.previous)
    .map((c) => {
      const now = c.current as WithPages;
      const before = c.previous as SnapshotQuery;
      const positionLoss = Math.max(c.positionChange ?? 0, 0);
      const viewsLost = Math.max(before.impressions - now.impressions, 0);
      const reasons: string[] = [];
      if (positionLoss > 0) {
        reasons.push(`Your position slipped from ${before.position.toFixed(1)} to ${now.position.toFixed(1)}`);
      }
      if (viewsLost > 0) {
        reasons.push(`Views fell from ${formatNumber(before.impressions)} to ${formatNumber(now.impressions)}`);
      }
      reasons.push("Check what changed on the ranking page and whether competitors moved ahead");
      return {
        type: "declining" as const,
        query: c.query,
        pageUrl: topPage(now),
        score: Number((viewsLost + now.impressions * Math.min(positionLoss / 10, 1)).toFixed(2)),
        reasons,
        metrics: metricsOf(now),
        previous: metricsOf(before),
      };
    });
}

function newOpportunities(changes: QueryChange[]): SearchOpportunity[] {
  return changes
    .filter((c) => c.trend === "new" && c.current)
    .map((c) => {
      const now = c.current as WithPages;
      return {
        type: "new_query" as const,
        query: c.query,
        pageUrl: topPage(now),
        score: now.impressions,
        reasons: [
          `New in the last 28 days: ${formatNumber(now.impressions)} views at position ${now.position.toFixed(1)}`,
          "People are starting to find you for this. Make sure the page answers it well",
        ],
        metrics: metricsOf(now),
        previous: null,
      };
    });
}

function lostOpportunities(changes: QueryChange[]): SearchOpportunity[] {
  return changes
    .filter((c) => c.trend === "lost" && c.previous)
    .map((c) => {
      const before = c.previous as SnapshotQuery;
      return {
        type: "lost_query" as const,
        query: c.query,
        pageUrl: null,
        score: before.impressions,
        reasons: [
          `You had ${formatNumber(before.impressions)} views for this before, and none in the last 28 days`,
          "Check whether the page was removed, redirected or blocked from search",
        ],
        metrics: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        previous: metricsOf(before),
      };
    });
}

/** Pure: turn one stored snapshot into grouped, explained opportunities. No network, no AI. */
export function buildOpportunities(payload: SearchSnapshotPayload): OpportunityGroups {
  const current = payload.windows.d28.queries;
  const changes = compareWindows(current, payload.windows.prev28.queries);

  return {
    ranking: rank(rankingOpportunities(current), MAX_RANKING),
    ctr: rank(ctrOpportunities(current), MAX_PER_GROUP),
    declining: rank(decliningOpportunities(changes), MAX_PER_GROUP),
    newQueries: rank(newOpportunities(changes), MAX_PER_GROUP),
    lostQueries: rank(lostOpportunities(changes), MAX_PER_GROUP),
    changes: summarizeChanges(changes),
  };
}
