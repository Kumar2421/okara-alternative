import { expectedCtr, type OpportunityGroups, type OpportunityMetrics, type OpportunityType, type SearchOpportunity } from "./searchOpportunities.ts";
import { normalizeQuery } from "./searchIntent.ts";
import type { SnapshotQuery } from "./searchSnapshot.ts";

export const OPPORTUNITY_TYPES: readonly OpportunityType[] = ["ranking", "ctr", "declining", "new_query", "lost_query"];

export function isOpportunityType(value: unknown): value is OpportunityType {
  return typeof value === "string" && (OPPORTUNITY_TYPES as readonly string[]).includes(value);
}

const GROUP_FOR: Record<OpportunityType, keyof Omit<OpportunityGroups, "changes">> = {
  ranking: "ranking",
  ctr: "ctr",
  declining: "declining",
  new_query: "newQueries",
  lost_query: "lostQueries",
};

/** Find the opportunity the user clicked, in the freshly computed groups (never trusting client-sent numbers). */
export function findOpportunity(groups: OpportunityGroups, type: OpportunityType, query: string): SearchOpportunity | null {
  const wanted = normalizeQuery(query);
  return groups[GROUP_FOR[type]].find((o) => normalizeQuery(o.query) === wanted) ?? null;
}

export type OpportunityFindingInput = {
  projectId: string;
  /** The site's brand, for suggested titles. */
  brand: string | null;
  capturedAt: string;
};

export type OpportunityEvidence = {
  query: string;
  opportunity: { type: OpportunityType; reasons: string[]; score: number };
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previous: OpportunityMetrics | null;
  brand: string | null;
  capturedAt: string;
};

function severityFor(opp: SearchOpportunity): "info" | "warning" | "critical" {
  if (opp.type === "declining" || opp.type === "lost_query") return "warning";
  if (opp.type === "ctr") return opp.metrics.impressions >= 500 ? "warning" : "info";
  return "info";
}

const HEADLINE: Record<OpportunityType, (query: string) => string> = {
  ranking: (q) => `Improve the page that ranks just below page one for “${q}”.`,
  ctr: (q) => `Rewrite the title and description for “${q}” to win more clicks.`,
  declining: (q) => `Find out why you slipped for “${q}” and win the ground back.`,
  new_query: (q) => `Build on the new search “${q}”.`,
  lost_query: (q) => `Find out why “${q}” stopped showing your site.`,
};

/** The Finding to save for an opportunity. Identity is `<type>:<normalized query>`, so the same search can have different issues and re-creating one never duplicates it. */
export function findingForOpportunity(opp: SearchOpportunity, input: OpportunityFindingInput) {
  const evidence: OpportunityEvidence = {
    query: opp.query,
    opportunity: { type: opp.type, reasons: opp.reasons, score: opp.score },
    clicks: opp.metrics.clicks,
    impressions: opp.metrics.impressions,
    ctr: opp.metrics.ctr,
    position: opp.metrics.position,
    previous: opp.previous,
    brand: input.brand,
    capturedAt: input.capturedAt,
  };
  return {
    projectId: input.projectId,
    source: "search-console",
    category: "search-visibility",
    severity: severityFor(opp),
    entityType: "query",
    entityId: `${opp.type}:${normalizeQuery(opp.query)}`,
    url: opp.pageUrl,
    evidence: evidence as unknown as Record<string, unknown>,
    recommendation: HEADLINE[opp.type](opp.query),
  };
}

/** True for findings created from a search opportunity (as opposed to a page-audit rule). */
export function opportunityEvidenceOf(evidence: Record<string, unknown>): OpportunityEvidence | null {
  const opportunity = evidence.opportunity as { type?: unknown } | undefined;
  if (!opportunity || !isOpportunityType(opportunity.type) || typeof evidence.query !== "string") return null;
  return evidence as unknown as OpportunityEvidence;
}

export type OpportunityVerdict = { resolved: boolean; reason: string };

const MIN_VIEWS = 50;
const IMPROVEMENT = 2;

/**
 * Has the problem this finding flagged gone away, judged from the latest
 * snapshot's numbers for the same search? `current` is that search's row in
 * the main window, or null when it no longer appears.
 */
export function evaluateOpportunity(evidence: OpportunityEvidence, current: SnapshotQuery | null): OpportunityVerdict {
  const type = evidence.opportunity.type;

  if (!current) {
    return { resolved: false, reason: "This search has no recent data yet. Refresh your search data and check again." };
  }

  const movedUp = evidence.position - current.position >= IMPROVEMENT;

  switch (type) {
    case "ranking":
      return current.position < 4 || movedUp
        ? { resolved: true, reason: `You now average position ${current.position.toFixed(1)}, up from ${evidence.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}. It needs to reach the top 3 or move up 2+ places.` };

    case "ctr": {
      const target = expectedCtr(current.position) * 0.5;
      return current.position <= 3.9 && current.ctr >= target
        ? { resolved: true, reason: `Click rate is now ${(current.ctr * 100).toFixed(1)}%.` }
        : { resolved: false, reason: `Click rate is ${(current.ctr * 100).toFixed(1)}%; it should be above ${(target * 100).toFixed(1)}% at this position.` };
    }

    case "declining": {
      const baseline = evidence.previous?.position ?? evidence.position;
      return current.position <= baseline + 1 || movedUp
        ? { resolved: true, reason: `Position recovered to ${current.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}, down from ${baseline.toFixed(1)}.` };
    }

    case "new_query":
      return movedUp || current.position <= 3.9
        ? { resolved: true, reason: `Moved up to position ${current.position.toFixed(1)}.` }
        : { resolved: false, reason: `Still at position ${current.position.toFixed(1)}.` };

    case "lost_query":
      return current.impressions >= MIN_VIEWS
        ? { resolved: true, reason: `Showing again: ${Math.round(current.impressions).toLocaleString("en-US")} views.` }
        : { resolved: false, reason: "Still barely showing for this search." };
  }
}
