/**
 * Rank the most impactful actions the user should take next.
 * Pure logic: no IO, no jargon, plain language for cards.
 */

import type { Finding } from "../findings/findingTypes.ts";

export type NextActionCard = {
  title: string;
  why: string;
  expectedImpact: string;
  findingId?: string;
};

/**
 * Turn findings and opportunities into a ranked list of next actions.
 * Skip findings already marked Fixed, return plain-language cards.
 * @param findings All findings for the project
 * @param opportunities The computed opportunity groups
 * @param limit Max cards to return (default 3)
 */
export function rankNextActions(
  findings: Finding[],
  opportunities: {
    ranking: Array<{ query: string; metrics: { impressions: number; position: number } }>;
    ctr: Array<{ query: string; metrics: { impressions: number; position: number } }>;
    declining: Array<{ query: string; metrics: { impressions: number } }>;
    newQueries: Array<{ query: string; metrics: { impressions: number } }>;
    lostQueries: Array<{ query: string; metrics: { impressions: number } }>;
  },
  limit: number = 3,
): NextActionCard[] {
  const actions: NextActionCard[] = [];

  // Skip findings that are already fixed or verified
  const fixableFinding = (f: Finding) => !["fixed", "verified"].includes(f.status);

  // 1. Improve highest-impact ranking opportunities
  for (const opp of opportunities.ranking.slice(0, 2)) {
    const finding = findings.find((f) => f.entityId === `ranking:${normalizeQuery(opp.query)}` && fixableFinding(f));
    const impressions = Math.round(opp.metrics.impressions);
    actions.push({
      title: `Improve page for "${opp.query}"`,
      why: `This search gets ${impressions} monthly views, but your page ranks just outside the top results.`,
      expectedImpact: `Moving into top 3 could add ~${Math.round(impressions * 0.15)} monthly clicks.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  // 2. Rewrite titles/descriptions for CTR opportunities
  for (const opp of opportunities.ctr.slice(0, 1)) {
    const finding = findings.find((f) => f.entityId === `ctr:${normalizeQuery(opp.query)}` && fixableFinding(f));
    const impressions = Math.round(opp.metrics.impressions);
    actions.push({
      title: `Rewrite snippet for "${opp.query}"`,
      why: `${impressions} people search for this monthly, but your click rate is unusually low for its position.`,
      expectedImpact: `A better title and description could lift clicks by ~${Math.round(impressions * 0.08)}.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  // 3. Investigate declining searches
  for (const opp of opportunities.declining.slice(0, 1)) {
    const finding = findings.find((f) => f.entityId === `declining:${normalizeQuery(opp.query)}` && fixableFinding(f));
    actions.push({
      title: `Recover position for "${opp.query}"`,
      why: `You lost ground on this search. It used to bring more traffic.`,
      expectedImpact: `Restoring your position could recover significant traffic.`,
      ...(finding ? { findingId: finding.id } : {}),
    });
  }

  return actions.slice(0, limit);
}

/** Normalize a query for consistent matching (lowercase, no extra whitespace). */
function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}
