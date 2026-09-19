import type { Finding } from "@/lib/domain/findings/findingTypes";
import type { Recommendation, RecommendationPriority, RecommendationType } from "./recommendationTypes";

type FindingPageEvidence = {
  meta?: { canonical?: string; indexable?: boolean };
  contentRelevance?: { keywordRelevance?: number };
  serverTiming?: { ttfbMs?: number };
};

function pageEvidence(finding: Finding): FindingPageEvidence {
  const page = finding.evidence.page;
  return page && typeof page === "object" ? page as FindingPageEvidence : {};
}

function recommendation(
  finding: Finding,
  type: RecommendationType,
  title: string,
  summary: string,
  priority: RecommendationPriority,
  kind: Recommendation["implementation"]["kind"],
  description: string,
  evidence: Record<string, unknown>,
): Recommendation {
  return {
    id: `${finding.id}:${type}`,
    findingId: finding.id,
    type,
    title,
    summary,
    priority,
    target: {
      url: finding.url ?? undefined,
      query: finding.entityType === "query" ? finding.entityId : undefined,
    },
    evidence,
    implementation: { kind, description },
  };
}

export function deriveRecommendations(finding: Finding): Recommendation[] {
  const page = pageEvidence(finding);
  const recommendations: Recommendation[] = [];

  if (page.meta?.indexable === false) {
    recommendations.push(recommendation(finding, "noindex", "Remove the noindex directive", "Allow the ranking page to be indexed if it is intended to receive organic search traffic.", "high", "code", "Remove the noindex directive from the page or its robots configuration, then re-crawl and verify indexability.", { indexable: false }));
  }
  if (!page.meta?.canonical) {
    recommendations.push(recommendation(finding, "missing_canonical", "Add a canonical URL", "Declare the preferred URL for this ranking page to consolidate search signals.", "high", "code", "Add a self-referencing canonical URL using the page's final public URL, then re-check the page.", { canonical: null }));
  }

  const keywordRelevance = page.contentRelevance?.keywordRelevance;
  if (typeof keywordRelevance === "number" && keywordRelevance < 50) {
    recommendations.push(recommendation(finding, "low_keyword_relevance", "Improve keyword relevance", "Align the page's visible content, headings, and topic coverage more closely with the ranking query.", keywordRelevance < 30 ? "high" : "medium", "content", "Review the query intent and strengthen relevant headings, copy, entities, and supporting content without keyword stuffing.", { keywordRelevance }));
  }

  const ttfbMs = page.serverTiming?.ttfbMs;
  if (typeof ttfbMs === "number" && ttfbMs > 1500) {
    recommendations.push(recommendation(finding, "slow_ttfb", "Investigate server response time", "Reduce time to first byte so the page begins responding faster.", ttfbMs > 2500 ? "high" : "medium", "manual", "Profile the request path, backend queries, caching, and upstream calls before making a performance change.", { ttfbMs }));
  }

  return recommendations;
}
