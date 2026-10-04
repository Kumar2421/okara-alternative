import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOpportunity, findingForOpportunity, findOpportunity, isOpportunityType, opportunityEvidenceOf } from "../lib/domain/search/opportunityFinding.ts";
import { deriveOpportunityRecommendations, suggestTitle } from "../lib/domain/search/opportunityRecommendations.ts";
import { deriveRecommendations } from "../lib/domain/recommendations/recommendationRules.ts";
import { deriveActionType } from "../lib/domain/actions/deriveActionType.ts";
import { evidenceRowsForFinding, whyItMattersForFinding } from "../lib/domain/findings/evidenceDisplay.ts";
import type { OpportunityGroups, OpportunityType, SearchOpportunity } from "../lib/domain/search/searchOpportunities.ts";

const metrics = (impressions: number, position: number, clicks = 10) => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

function opp(type: OpportunityType, query: string, m = metrics(1200, 8.2), extra: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return { type, query, pageUrl: "https://example.com/seo", score: 50, reasons: ["Reason one", "Reason two"], metrics: m, previous: null, ...extra };
}

const NOW = { projectId: "p1", brand: "Marlo", capturedAt: "2026-10-10T00:00:00.000Z" };

function groupsWith(o: SearchOpportunity): OpportunityGroups {
  const empty: OpportunityGroups = { ranking: [], ctr: [], declining: [], newQueries: [], lostQueries: [], changes: { up: 0, down: 0, new: 0, lost: 0 } };
  const key = { ranking: "ranking", ctr: "ctr", declining: "declining", new_query: "newQueries", lost_query: "lostQueries" }[o.type] as keyof Omit<OpportunityGroups, "changes">;
  return { ...empty, [key]: [o] };
}

test("isOpportunityType accepts the five types only", () => {
  for (const t of ["ranking", "ctr", "declining", "new_query", "lost_query"]) assert.equal(isOpportunityType(t), true);
  assert.equal(isOpportunityType("content_gap"), false);
  assert.equal(isOpportunityType(undefined), false);
});

test("findOpportunity finds by type and normalized query, ignoring case and spacing", () => {
  const groups = groupsWith(opp("ctr", "Best SEO Tool"));
  assert.equal(findOpportunity(groups, "ctr", "  best seo   tool ")?.query, "Best SEO Tool");
  assert.equal(findOpportunity(groups, "ranking", "best seo tool"), null, "same query, different type");
  assert.equal(findOpportunity(groups, "ctr", "other"), null);
});

test("findingForOpportunity: identity is type + normalized query, so re-creating never duplicates", () => {
  const a = findingForOpportunity(opp("ranking", "Best SEO Tool"), NOW);
  const b = findingForOpportunity(opp("ranking", "best  seo tool"), NOW);
  assert.equal(a.entityId, "ranking:best seo tool");
  assert.equal(a.entityId, b.entityId);
  assert.equal(a.source, "search-console");
  assert.equal(a.category, "search-visibility");
  assert.equal(a.entityType, "query");
  assert.equal(a.url, "https://example.com/seo");
});

test("findingForOpportunity: the same search with a different issue is a different finding", () => {
  assert.notEqual(
    findingForOpportunity(opp("ranking", "x"), NOW).entityId,
    findingForOpportunity(opp("ctr", "x"), NOW).entityId,
  );
});

test("findingForOpportunity: severity reflects how costly the issue is", () => {
  assert.equal(findingForOpportunity(opp("declining", "x"), NOW).severity, "warning");
  assert.equal(findingForOpportunity(opp("lost_query", "x"), NOW).severity, "warning");
  assert.equal(findingForOpportunity(opp("ctr", "x", metrics(900, 2)), NOW).severity, "warning");
  assert.equal(findingForOpportunity(opp("ctr", "x", metrics(200, 2)), NOW).severity, "info");
  assert.equal(findingForOpportunity(opp("ranking", "x"), NOW).severity, "info");
  assert.equal(findingForOpportunity(opp("new_query", "x"), NOW).severity, "info");
});

test("findingForOpportunity stores the evidence and can be read back", () => {
  const f = findingForOpportunity(opp("declining", "x", metrics(800, 11), { previous: metrics(1200, 6) }), NOW);
  const e = opportunityEvidenceOf(f.evidence);
  assert.equal(e?.opportunity.type, "declining");
  assert.equal(e?.previous?.position, 6);
  assert.equal(e?.brand, "Marlo");
  assert.equal(opportunityEvidenceOf({ query: "x" }), null);
  assert.equal(opportunityEvidenceOf({ page: {} }), null);
});

function evidenceFor(type: OpportunityType, m = metrics(1200, 8), previous = null as ReturnType<typeof metrics> | null) {
  return opportunityEvidenceOf(findingForOpportunity(opp(type, "x", m, { previous }), NOW).evidence)!;
}

const row = (position: number, impressions = 1000, clicks = 5) => ({ query: "x", impressions, clicks, ctr: clicks / impressions, position });

test("evaluate ranking: top 3 or +2 places resolves; barely moved does not", () => {
  const e = evidenceFor("ranking", metrics(1200, 8));
  assert.equal(evaluateOpportunity(e, row(2.5)).resolved, true);
  assert.equal(evaluateOpportunity(e, row(5.9)).resolved, true);
  assert.equal(evaluateOpportunity(e, row(7.5)).resolved, false);
});

test("evaluate ctr: needs a healthy click rate while still ranking near the top", () => {
  const e = evidenceFor("ctr", metrics(1000, 2, 10));
  assert.equal(evaluateOpportunity(e, row(2, 1000, 120)).resolved, true);
  assert.equal(evaluateOpportunity(e, row(2, 1000, 10)).resolved, false);
  assert.equal(evaluateOpportunity(e, row(6, 1000, 120)).resolved, false, "dropping out of the top is not a fix");
});

test("evaluate declining: recovering toward the old position resolves", () => {
  const e = evidenceFor("declining", metrics(800, 11), metrics(1200, 6));
  assert.equal(evaluateOpportunity(e, row(6.5)).resolved, true);
  assert.equal(evaluateOpportunity(e, row(10)).resolved, false);
});

test("evaluate new and lost queries", () => {
  assert.equal(evaluateOpportunity(evidenceFor("new_query", metrics(300, 14)), row(9)).resolved, true);
  assert.equal(evaluateOpportunity(evidenceFor("new_query", metrics(300, 14)), row(13)).resolved, false);
  assert.equal(evaluateOpportunity(evidenceFor("lost_query", metrics(0, 0, 0), metrics(800, 5)), row(5, 300)).resolved, true);
  assert.equal(evaluateOpportunity(evidenceFor("lost_query", metrics(0, 0, 0), metrics(800, 5)), row(5, 10)).resolved, false);
});

test("evaluate without current data says so instead of guessing", () => {
  const verdict = evaluateOpportunity(evidenceFor("ranking"), null);
  assert.equal(verdict.resolved, false);
  assert.match(verdict.reason, /no recent data/i);
});

test("suggestTitle: title case, brand when it fits, never over 60 characters", () => {
  assert.equal(suggestTitle("best seo tool for startups", "Marlo"), "Best SEO Tool for Startups | Marlo".replace("SEO", "Seo"));
  assert.ok(suggestTitle("a".repeat(30) + " " + "b".repeat(40), "Marlo").length <= 60);
  assert.equal(suggestTitle("seo tools", null), "Seo Tools");
  assert.ok(suggestTitle("word ".repeat(40).trim(), "Marlo").length <= 60);
});

test("every opportunity type yields a recommendation with steps, a title and a target", () => {
  const types: OpportunityType[] = ["ranking", "ctr", "declining", "new_query", "lost_query"];
  const expected = ["improve_search_intent_alignment", "rewrite_snippet", "investigate_decline", "build_on_new_query", "investigate_lost_query"];
  types.forEach((type, i) => {
    const f = findingForOpportunity(opp(type, "best seo tool", metrics(1500, 6), { previous: metrics(1800, 4) }), NOW);
    const recs = deriveOpportunityRecommendations({ id: "f1", url: f.url, evidence: f.evidence });
    assert.equal(recs?.length, 1);
    assert.equal(recs?.[0].type, expected[i]);
    assert.equal(recs?.[0].id, `f1:${expected[i]}`);
    assert.equal(recs?.[0].target.query, "best seo tool");
    assert.ok(recs![0].implementation.description.includes("1."), "numbered steps");
  });
});

test("deriveRecommendations uses opportunity steps, not page-audit rules, for opportunity findings", () => {
  const f = findingForOpportunity(opp("ctr", "best seo tool", metrics(2000, 2)), NOW);
  const recs = deriveRecommendations({ id: "f1", entityType: f.entityType, entityId: f.entityId, url: f.url, evidence: f.evidence });
  assert.deepEqual(recs.map((r) => r.type), ["rewrite_snippet"]);
  assert.equal(recs[0].priority, "high");
  assert.match(recs[0].implementation.description, /Best Seo Tool/);
});

test("lost-query recommendation reads the earlier views, and a new query without a page asks for one", () => {
  const lost = findingForOpportunity(opp("lost_query", "x", metrics(0, 0, 0), { pageUrl: null, previous: metrics(800, 5) }), NOW);
  assert.match(deriveOpportunityRecommendations({ id: "f", url: null, evidence: lost.evidence })![0].summary, /800 views/);
  const fresh = findingForOpportunity(opp("new_query", "geo agent", metrics(300, 14), { pageUrl: null }), NOW);
  assert.equal(deriveOpportunityRecommendations({ id: "f", url: null, evidence: fresh.evidence })![0].title, "Give this new search its own page");
});

test("page-audit findings are not treated as opportunity findings", () => {
  assert.equal(deriveOpportunityRecommendations({ id: "f", url: null, evidence: { page: { meta: { indexable: false } } } }), null);
});

test("deriveActionType maps opportunity types to a fitting action", () => {
  const type = (t: OpportunityType) => {
    const f = findingForOpportunity(opp(t, "x"), NOW);
    return deriveActionType({ source: f.source, entityId: f.entityId, evidence: f.evidence });
  };
  assert.equal(type("ctr"), "rewrite_snippet");
  assert.equal(type("declining"), "investigate_ranking_change");
  assert.equal(type("lost_query"), "investigate_ranking_change");
  assert.equal(type("ranking"), "improve_content_relevance");
  assert.equal(type("new_query"), "improve_content_relevance");
});

test("deriveActionType is unchanged for existing finding sources", () => {
  assert.equal(deriveActionType({ source: "seo-audit", entityId: "canonical-missing", evidence: {} }), "add_canonical");
  assert.equal(deriveActionType({ source: "search-console", entityId: "q", evidence: { page: { meta: { indexable: false } } } }), "remove_noindex");
});

test("evidence rows for an opportunity finding show search, type, views and the earlier position", () => {
  const f = findingForOpportunity(opp("declining", "best seo tool", metrics(800, 11.2), { previous: metrics(1200, 6) }), NOW);
  const rows = Object.fromEntries(evidenceRowsForFinding({ source: f.source, evidence: f.evidence }).map((r) => [r.key, r.value]));
  assert.equal(rows.query, "best seo tool");
  assert.equal(rows.type, "Slipping");
  assert.equal(rows.impressions, "800");
  assert.equal(rows.position, "11.2");
  assert.equal(rows.previousPosition, "6.0");
  assert.equal("canonical" in rows, false, "no page-audit rows");
  assert.match(whyItMattersForFinding({ source: f.source, evidence: f.evidence }) ?? "", /Reason one\. Reason two\./);
});

import { snapshotRanges, type SearchSnapshotPayload } from "../lib/domain/search/searchSnapshot.ts";
import { opportunityFindingFromSnapshot, recheckOpportunityFinding } from "../lib/domain/search/opportunityFinding.ts";

function snapshot(queries: Array<ReturnType<typeof metrics> & { query: string; rankingPages?: Array<{ url: string }> }>): SearchSnapshotPayload {
  const r = snapshotRanges(new Date("2026-10-10T00:00:00Z"));
  return {
    version: 1,
    capturedAt: "2026-10-10T00:00:00.000Z",
    siteUrl: "sc-domain:example.com",
    windows: {
      d7: { ...r.d7, queries: [] },
      d28: { ...r.d28, queries: queries.map((q) => ({ ...q, rankingPages: q.rankingPages ?? [] })) },
      d90: { ...r.d90, queries: [] },
      prev28: { ...r.prev28, queries: [] },
    },
  } as unknown as SearchSnapshotPayload;
}

const args = { type: "ctr" as OpportunityType, query: "Marlo Pricing", projectId: "p1", brand: "Marlo", projectUrl: "https://example.com" };

test("opportunityFindingFromSnapshot uses the snapshot's numbers and keeps only the project's own page", () => {
  const payload = snapshot([{ query: "marlo pricing", ...metrics(900, 2.1, 11), rankingPages: [{ url: "https://www.example.com/pricing" }] }]);
  const result = opportunityFindingFromSnapshot({ ...args, payload });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.input.entityId, "ctr:marlo pricing");
    assert.equal(result.input.url, "https://www.example.com/pricing");
    assert.equal((result.input.evidence as { impressions: number }).impressions, 900);
  }
});

test("opportunityFindingFromSnapshot drops a page link from another site", () => {
  const payload = snapshot([{ query: "marlo pricing", ...metrics(900, 2.1, 11), rankingPages: [{ url: "https://evil.example.org/x" }] }]);
  const result = opportunityFindingFromSnapshot({ ...args, payload });
  assert.equal(result.ok && result.input.url, null);
});

test("opportunityFindingFromSnapshot refuses without data or when the opportunity is stale", () => {
  const none = opportunityFindingFromSnapshot({ ...args, payload: null });
  assert.deepEqual(none, { ok: false, status: 409, error: "No saved search data yet. Use Refresh now first." });
  const stale = opportunityFindingFromSnapshot({ ...args, payload: snapshot([{ query: "marlo pricing", ...metrics(900, 2.1, 400) }]) });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.status, 409);
});

test("recheckOpportunityFinding verifies when the problem is gone and records why", () => {
  const found = opportunityFindingFromSnapshot({ ...args, payload: snapshot([{ query: "marlo pricing", ...metrics(900, 2.1, 11) }]) });
  assert.ok(found.ok);
  if (!found.ok) return;
  const finding = { severity: found.input.severity, recommendation: found.input.recommendation, evidence: found.input.evidence };

  const fixed = recheckOpportunityFinding(finding, { snapshotDate: "2026-10-24", payload: snapshot([{ query: "Marlo Pricing", ...metrics(1000, 2, 150) }]) }, new Date("2026-10-24T00:00:00Z"));
  assert.equal(fixed.issueDetected, false);
  assert.equal((fixed.evidence.lastCheck as { resolved: boolean }).resolved, true);
  assert.equal((fixed.evidence.lastCheck as { snapshotDate: string }).snapshotDate, "2026-10-24");
  assert.equal((fixed.evidence as Record<string, unknown>).query, finding.evidence.query, "original evidence is kept");

  const still = recheckOpportunityFinding(finding, { snapshotDate: "2026-10-24", payload: snapshot([{ query: "marlo pricing", ...metrics(1000, 2, 10) }]) });
  assert.equal(still.issueDetected, true);

  const noData = recheckOpportunityFinding(finding, null);
  assert.equal(noData.issueDetected, true);
  assert.match((noData.evidence.lastCheck as { reason: string }).reason, /no recent data/i);
});

import { findExistingFinding } from "../lib/domain/search/opportunityFinding.ts";

test("findExistingFinding matches the same issue, including when there is no page URL", () => {
  const input = findingForOpportunity(opp("lost_query", "free seo audit", metrics(0, 0, 0), { pageUrl: null }), NOW);
  const stored = [
    { id: "a", ...findingForOpportunity(opp("ranking", "free seo audit"), NOW) },
    { id: "b", ...input },
  ];
  assert.equal(findExistingFinding(stored, input)?.id, "b");
  assert.equal(input.url, null);
});

test("findExistingFinding distinguishes type, query and page", () => {
  const base = findingForOpportunity(opp("ctr", "marlo pricing"), NOW);
  const stored = [{ id: "a", ...base }];
  assert.equal(findExistingFinding(stored, findingForOpportunity(opp("ranking", "marlo pricing"), NOW)), null, "other type");
  assert.equal(findExistingFinding(stored, findingForOpportunity(opp("ctr", "other query"), NOW)), null, "other query");
  assert.equal(findExistingFinding(stored, findingForOpportunity(opp("ctr", "marlo pricing", metrics(1, 1), { pageUrl: "https://example.com/x" }), NOW)), null, "other page");
  assert.equal(findExistingFinding(stored, findingForOpportunity(opp("ctr", "  Marlo   Pricing "), NOW))?.id, "a", "case and spacing do not matter");
});
