import { normalizeQuery } from "./searchIntent.ts";
import type { ClassifiedQuery, SearchIntent, SearchTheme } from "./types.ts";

const MERGE_THRESHOLD = 0.7;

const STOPWORDS = new Set([
  "a", "an", "the", "for", "to", "of", "in", "on", "with", "and", "or", "is", "are", "how", "what",
  "do", "does", "i", "my", "me", "your", "vs", "versus", "best", "top", "recommended", "leading",
  "alternative", "alternatives", "cheap", "cheapest", "free", "review", "reviews", "compare",
  "comparison", "pricing", "price", "cost",
]);

// Small, explicit synonym folding so "seo software" and "seo tools" group together.
const CANONICAL: Record<string, string> = {
  tools: "tool", software: "tool", platform: "tool", platforms: "tool", app: "tool", apps: "tool",
  startups: "startup", agencies: "agency", freelancers: "freelancer", businesses: "business",
};

function topicTokens(query: string): Set<string> {
  const all = normalizeQuery(query).split(" ").filter(Boolean);
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  return new Set((meaningful.length > 0 ? meaningful : all).map((word) => CANONICAL[word] ?? word));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

type Cluster = { seed: Set<string>; members: ClassifiedQuery[] };

function summarize(cluster: Cluster): SearchTheme {
  const members = [...cluster.members].sort((a, b) => b.impressions - a.impressions);
  const clicks = members.reduce((sum, m) => sum + m.clicks, 0);
  const impressions = members.reduce((sum, m) => sum + m.impressions, 0);
  const weightedPosition = members.reduce((sum, m) => sum + m.position * m.impressions, 0);

  const intentImpressions = new Map<SearchIntent, number>();
  for (const m of members) intentImpressions.set(m.intent, (intentImpressions.get(m.intent) ?? 0) + m.impressions);
  const [intent] = [...intentImpressions.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    label: members[0].query,
    intent,
    queries: members.length,
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
    examples: members.slice(0, 3).map((m) => m.query),
  };
}

/**
 * Greedy clustering of related queries by topic-token overlap. Input order
 * does not matter: queries are processed highest-impressions first so the
 * biggest query seeds (and names) each theme. Cost is O(n × themes), so the
 * caller should cap n.
 */
export function clusterQueries(queries: ClassifiedQuery[]): SearchTheme[] {
  const ordered = [...queries].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  const clusters: Cluster[] = [];

  for (const query of ordered) {
    const tokens = topicTokens(query.query);
    const home = clusters.find((cluster) => jaccard(tokens, cluster.seed) >= MERGE_THRESHOLD);
    if (home) home.members.push(query);
    else clusters.push({ seed: tokens, members: [query] });
  }

  return clusters
    .map(summarize)
    .sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label));
}
