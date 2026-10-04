import { deriveOpportunityRecommendations } from "../search/opportunityRecommendations.ts";
import type { Recommendation, RecommendationPriority, RecommendationType } from "./recommendationTypes.ts";

type FindingLike = {
  id: string;
  entityType: string;
  entityId: string;
  url: string | null;
  evidence: Record<string, unknown>;
};

type FindingPageEvidence = {
  meta?: { canonical?: string; indexable?: boolean };
  contentRelevance?: { keywordRelevance?: number };
  serverTiming?: { ttfbMs?: number };
};

function pageEvidence(finding: FindingLike): FindingPageEvidence {
  const page = finding.evidence.page;
  return page && typeof page === "object" ? (page as FindingPageEvidence) : {};
}

function recommendation(
  finding: FindingLike,
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

export function deriveRecommendations(finding: FindingLike): Recommendation[] {
  // Findings created from a search opportunity carry their own evidence and steps, not page-audit conditions.
  const fromOpportunity = deriveOpportunityRecommendations(finding);
  if (fromOpportunity) return fromOpportunity;

  const page = pageEvidence(finding);
  const recommendations: Recommendation[] = [];

  if (page.meta?.indexable === false) {
    recommendations.push(
      recommendation(
        finding,
        "noindex",
        "Remove the noindex directive",
        "Allow the ranking page to be indexed if it is intended to receive organic search traffic.",
        "high",
        "code",
        "Remove the noindex directive from the page or its robots configuration, then re-crawl and verify indexability.",
        { indexable: false },
      ),
    );
  }

  if (!page.meta?.canonical) {
    recommendations.push(
      recommendation(
        finding,
        "missing_canonical",
        "Add a canonical URL",
        "Declare the preferred URL for this ranking page to consolidate search signals.",
        "high",
        "code",
        "Add a self-referencing canonical URL using the page's final public URL, then re-check the page.",
        { canonical: null },
      ),
    );
  }

  const keywordRelevance = page.contentRelevance?.keywordRelevance;
  if (typeof keywordRelevance === "number" && keywordRelevance < 50) {
    recommendations.push(
      recommendation(
        finding,
        "low_keyword_relevance",
        "Improve keyword relevance",
        "Align the page's visible content, headings, and topic coverage more closely with the ranking query.",
        keywordRelevance < 30 ? "high" : "medium",
        "content",
        "Review the query intent and strengthen relevant headings, copy, entities, and supporting content without keyword stuffing.",
        { keywordRelevance },
      ),
    );
  }

  if (finding.evidence.auditId && finding.evidence.device) {
    const mode = typeof finding.evidence.mode === "string" ? finding.evidence.mode : "diagnostic";
    const displayValue = typeof finding.evidence.displayValue === "string" ? finding.evidence.displayValue : undefined;
    const score = typeof finding.evidence.score === "number" ? Math.round(finding.evidence.score * 100) : undefined;
    recommendations.push(
      recommendation(
        finding,
        "lighthouse_issue",
        mode === "opportunity" ? "Improve this Lighthouse opportunity" : "Address this Lighthouse diagnostic",
        displayValue
          ? `${displayValue}. This audit identifies a measurable Lighthouse issue on the ${String(finding.evidence.device)} experience.`
          : "This Lighthouse audit identifies a performance, accessibility, best-practice, or SEO issue worth addressing.",
        score !== undefined && score < 50 ? "high" : "medium",
        "manual",
        "Review the Lighthouse audit details, make the smallest relevant page or application change, then re-run the SEO audit to confirm the score improves.",
        { device: finding.evidence.device, mode, score, displayValue, auditId: finding.evidence.auditId },
      ),
    );
  }

  const ttfbMs = page.serverTiming?.ttfbMs;
  if (typeof ttfbMs === "number" && ttfbMs > 1500) {
    recommendations.push(
      recommendation(
        finding,
        "slow_ttfb",
        "Investigate server response time",
        "Reduce time to first byte so the page begins responding faster.",
        ttfbMs > 2500 ? "high" : "medium",
        "manual",
        "Profile the request path, backend queries, caching, and upstream calls before making a performance change.",
        { ttfbMs },
      ),
    );
  }

  return recommendations;
}
