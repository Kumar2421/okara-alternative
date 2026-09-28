import type { ActionType } from "./actionTypes.ts";

type FindingLike = {
  source: string;
  entityId: string;
  evidence: Record<string, unknown>;
};

/**
 * Picks the ActionType for a finding server-side, so the client never has
 * to duplicate this mapping (and can't send a mismatched type). SEO-audit
 * findings only have one issueId with a dedicated automated type today
 * (canonical-missing); everything else — and any finding whose evidence
 * doesn't match a known automated condition — falls back to the generic
 * manual_fix type.
 *
 * The analytics-finding conditions mirror recommendationRules.ts exactly,
 * so an action created from a finding always matches the recommendation
 * that finding already shows.
 */
export function deriveActionType(finding: FindingLike): ActionType {
  if (finding.source === "seo-audit") {
    return finding.entityId === "canonical-missing" ? "add_canonical" : "manual_fix";
  }

  const page = (finding.evidence.page ?? {}) as Record<string, unknown>;
  const meta = (page.meta ?? {}) as Record<string, unknown>;
  const relevance = (page.contentRelevance ?? {}) as Record<string, unknown>;
  const timing = (page.serverTiming ?? {}) as Record<string, unknown>;

  if (meta.indexable === false) return "remove_noindex";
  if (!meta.canonical) return "add_canonical";
  if (typeof relevance.keywordRelevance === "number" && relevance.keywordRelevance < 50) return "improve_content_relevance";
  if (typeof timing.ttfbMs === "number" && timing.ttfbMs > 1500) return "investigate_ttfb";
  return "manual_fix";
}
