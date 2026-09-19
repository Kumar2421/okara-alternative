export type FindingEvidence = {
  meta: { title: string; canonical?: string; indexable: boolean };
  contentRelevance: { keywordRelevance: number };
  serverTiming: { ttfbMs?: number };
};

export type FindingRuleResult = {
  severity: "warning" | "critical";
  recommendation: string;
};

export function deriveSearchFinding(evidence: FindingEvidence): FindingRuleResult | null {
  const issues: string[] = [];
  if (!evidence.meta.indexable) issues.push("Page is marked noindex.");
  if (!evidence.meta.canonical) issues.push("Page is missing a canonical URL.");
  if (evidence.contentRelevance.keywordRelevance < 50) issues.push("Page content has low keyword relevance.");
  if (typeof evidence.serverTiming.ttfbMs === "number" && evidence.serverTiming.ttfbMs > 1500) {
    issues.push("Page TTFB is above 1500 ms.");
  }
  if (issues.length === 0) return null;

  return {
    severity: !evidence.meta.indexable || evidence.contentRelevance.keywordRelevance < 30 ? "critical" : "warning",
    recommendation: [...issues, "Review the ranking page and address the listed issues before re-checking the query."].join(" "),
  };
}
