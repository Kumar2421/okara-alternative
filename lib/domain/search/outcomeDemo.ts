import type { ActionType } from "../actions/actionTypes.ts";
import type { Finding } from "../findings/findingTypes.ts";
import { findingForOpportunity } from "./opportunityFinding.ts";
import { deriveOpportunityRecommendations } from "./opportunityRecommendations.ts";
import type { ImplementationRecord } from "./actionOutcome.ts";
import type { PageFingerprint } from "./pageFingerprint.ts";
import type { OpportunityType, SearchOpportunity } from "./searchOpportunities.ts";
import type { SnapshotQuery } from "./searchSnapshot.ts";

/** Every demo search starts with this, so cleanup can find exactly what was seeded. */
export const DEMO_PREFIX = "demo ";
export const DEMO_ACTION_PREFIX = "action_demo_";

type Numbers = { impressions: number; clicks: number; position: number };

type Scenario = {
  key: string;
  label: string;
  query: string;
  opportunityType: OpportunityType;
  actionType: ActionType;
  daysAgo: number;
  baseline: Numbers;
  current: Numbers;
  /** The page's title/description/heading before, and (if it was looked at again) after. */
  pageBefore: PageFingerprint;
  pageAfter: PageFingerprint | null;
};

const OLD: PageFingerprint = { title: "Old title", description: "Old description", h1: "Old heading" };
const NEW: PageFingerprint = { title: "Best SEO Tool for Startups | Demo", description: "A clearer description.", h1: "Best SEO tool for startups" };

/** One tracked fix per outcome state, so every card can be seen without waiting weeks. */
const SCENARIOS: Scenario[] = [
  { key: "waiting", label: "Waiting", query: "demo waiting for data", opportunityType: "ranking", actionType: "improve_content_relevance", daysAgo: 3,
    baseline: { impressions: 1000, clicks: 30, position: 11 }, current: { impressions: 1000, clicks: 30, position: 11 }, pageBefore: OLD, pageAfter: null },
  { key: "early", label: "Improved (early signal)", query: "demo early improvement", opportunityType: "ranking", actionType: "improve_content_relevance", daysAgo: 9,
    baseline: { impressions: 1000, clicks: 30, position: 11 }, current: { impressions: 1100, clicks: 50, position: 6.8 }, pageBefore: OLD, pageAfter: NEW },
  { key: "improved", label: "Improved (solid)", query: "demo solid improvement", opportunityType: "ranking", actionType: "improve_content_relevance", daysAgo: 20,
    baseline: { impressions: 1000, clicks: 30, position: 11 }, current: { impressions: 1300, clicks: 80, position: 5.2 }, pageBefore: OLD, pageAfter: NEW },
  { key: "worse", label: "Got worse", query: "demo got worse", opportunityType: "declining", actionType: "investigate_ranking_change", daysAgo: 14,
    baseline: { impressions: 1000, clicks: 60, position: 5 }, current: { impressions: 800, clicks: 25, position: 9.1 }, pageBefore: OLD, pageAfter: NEW },
  { key: "not-applied", label: "Change not seen", query: "demo snippet rewrite", opportunityType: "ctr", actionType: "rewrite_snippet", daysAgo: 14,
    baseline: { impressions: 1000, clicks: 12, position: 2 }, current: { impressions: 1000, clicks: 13, position: 2 }, pageBefore: OLD, pageAfter: OLD },
  { key: "cant-measure", label: "Can't measure", query: "demo too few views", opportunityType: "ranking", actionType: "improve_content_relevance", daysAgo: 14,
    baseline: { impressions: 40, clicks: 1, position: 12 }, current: { impressions: 45, clicks: 2, position: 9 }, pageBefore: OLD, pageAfter: NEW },
];

const row = (query: string, n: Numbers): SnapshotQuery => ({ query, impressions: n.impressions, clicks: n.clicks, ctr: n.impressions ? n.clicks / n.impressions : 0, position: n.position });

export type DemoRows = {
  finding: Omit<Finding, "id" | "firstSeen" | "lastSeen" | "resolvedAt" | "status"> & { id: string; status: Finding["status"]; firstSeen: string; lastSeen: string; resolvedAt: string | null };
  action: {
    id: string; findingId: string; recommendationId: string; type: ActionType; title: string; target: { url: string };
    result: { implementation: ImplementationRecord }; createdAt: string; completedAt: string;
  };
  /** This search's row for the snapshot's main window, at today's numbers. */
  snapshotQuery: SnapshotQuery;
  label: string;
};

/** Pure: everything the demo seeds, derived from the app's own logic so it can't drift from real behaviour. */
export function buildDemoRows(args: { projectId: string; projectUrl: string; now: Date; newId: () => string }): DemoRows[] {
  const base = args.projectUrl.replace(/\/$/, "");
  return SCENARIOS.map((s, index) => {
    const url = `${base}/demo-page-${index + 1}`;
    const opportunity: SearchOpportunity = {
      type: s.opportunityType,
      query: s.query,
      pageUrl: url,
      score: 10,
      reasons: ["Demo data created by the seed script", "Not real search numbers"],
      metrics: { ...s.baseline, ctr: s.baseline.clicks / s.baseline.impressions },
      previous: null,
    };
    const input = findingForOpportunity(opportunity, { projectId: args.projectId, brand: "Demo", capturedAt: args.now.toISOString() });
    const findingId = args.newId();
    const implementedAt = new Date(args.now.getTime() - s.daysAgo * 86_400_000).toISOString();
    const recommendation = deriveOpportunityRecommendations({ id: findingId, url, evidence: input.evidence })![0];

    return {
      label: s.label,
      finding: { ...input, id: findingId, status: "fixed", firstSeen: implementedAt, lastSeen: implementedAt, resolvedAt: null } as DemoRows["finding"],
      action: {
        id: `${DEMO_ACTION_PREFIX}${s.key}`,
        findingId,
        recommendationId: recommendation.id,
        type: s.actionType,
        title: recommendation.title,
        target: { url },
        createdAt: implementedAt,
        completedAt: implementedAt,
        result: {
          implementation: {
            via: "manual",
            implementedAt,
            baseline: {
              capturedAt: implementedAt, snapshotDate: implementedAt.slice(0, 10), query: s.query, ...s.baseline,
              ctr: s.baseline.clicks / s.baseline.impressions, source: "snapshot",
            },
            pageUrl: url,
            pageBefore: s.pageBefore,
            ...(s.pageAfter ? { pageAfter: s.pageAfter } : {}),
          },
        },
      },
      snapshotQuery: row(s.query, s.current),
    };
  });
}
