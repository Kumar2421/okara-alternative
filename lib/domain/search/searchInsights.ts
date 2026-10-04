import { clusterQueries } from "./queryClustering.ts";
import { classifyQuery } from "./searchIntent.ts";
import type { ClassifiedQuery, IntentSummary, QueryRow, SearchInsights, SearchIntent } from "./types.ts";

/** Clustering is quadratic-ish, and the long tail adds noise, not insight. */
export const MAX_ANALYSED_QUERIES = 500;
const MAX_THEMES = 8;

/**
 * Turn raw Search Console query rows into plain-language insight: what kinds
 * of searches bring people in (intents) and which topics they cluster into
 * (themes). Pure and deterministic; no network, no AI.
 */
export function buildSearchInsights(rows: QueryRow[], brandTerms: string[] = []): SearchInsights {
  const classified: ClassifiedQuery[] = rows
    .filter((row) => row.impressions > 0 && (row.keys[0]?.trim() ?? "").length > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_ANALYSED_QUERIES)
    .map((row) => {
      const query = row.keys[0].trim();
      const { intent, signals } = classifyQuery(query, brandTerms);
      return { query, intent, signals, clicks: row.clicks, impressions: row.impressions, position: row.position };
    });

  const totalImpressions = classified.reduce((sum, q) => sum + q.impressions, 0);
  const byIntent = new Map<SearchIntent, IntentSummary>();
  for (const q of classified) {
    const current = byIntent.get(q.intent) ?? { intent: q.intent, queries: 0, clicks: 0, impressions: 0, share: 0 };
    current.queries += 1;
    current.clicks += q.clicks;
    current.impressions += q.impressions;
    byIntent.set(q.intent, current);
  }
  const intents = [...byIntent.values()]
    .map((summary) => ({ ...summary, share: totalImpressions > 0 ? summary.impressions / totalImpressions : 0 }))
    .sort((a, b) => b.impressions - a.impressions);

  return {
    analysedQueries: classified.length,
    intents,
    themes: clusterQueries(classified).slice(0, MAX_THEMES),
  };
}
