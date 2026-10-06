import test from "node:test";
import assert from "node:assert/strict";
import {
  baselineFor, buildImplementation, evaluateOutcome, implementationOf, MIN_BASELINE_IMPRESSIONS, MIN_DAYS, outcomeForAction, SOLID_DAYS,
  type ImplementationRecord,
} from "../lib/domain/search/actionOutcome.ts";
import { findingForOpportunity, opportunityEvidenceOf } from "../lib/domain/search/opportunityFinding.ts";
import { snapshotRanges, type SearchSnapshotPayload, type SnapshotQuery } from "../lib/domain/search/searchSnapshot.ts";
import type { OpportunityType, SearchOpportunity } from "../lib/domain/search/searchOpportunities.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T00:00:00Z");
const later = (days: number) => new Date(T0.getTime() + days * DAY);

const row = (position: number, impressions = 1000, clicks = 30, query = "best seo tool"): SnapshotQuery => ({
  query, impressions, clicks, ctr: impressions ? clicks / impressions : 0, position,
});

function record(partial: Partial<ImplementationRecord["baseline"] & object> = {}, extra: Partial<ImplementationRecord> = {}): ImplementationRecord {
  return {
    via: "manual",
    implementedAt: T0.toISOString(),
    baseline: { capturedAt: T0.toISOString(), snapshotDate: "2026-10-01", query: "best seo tool", impressions: 1000, clicks: 30, ctr: 0.03, position: 11, source: "snapshot", ...partial },
    ...extra,
  };
}

const evalAt = (days: number, current: SnapshotQuery | null, type: "improve_content_relevance" | "rewrite_snippet" | "investigate_ranking_change" = "improve_content_relevance", rec = record()) =>
  evaluateOutcome({ implementation: rec, actionType: type, current, now: later(days) });

test("before the minimum wait the verdict is waiting, and says how long", () => {
  const o = evalAt(3, row(5));
  assert.equal(o.status, "waiting");
  assert.equal(o.daysUntilReady, MIN_DAYS - 3);
  assert.match(o.headline, /Check back in 4 days/);
  assert.equal(evalAt(6, row(5)).headline.includes("1 day."), true);
});

test("position moving up a place or more is an improvement; early signal until 14 days", () => {
  const early = evalAt(9, row(6.8));
  assert.equal(early.status, "improved");
  assert.equal(early.confidence, "early");
  assert.match(early.headline, /position 11\.0 → 6\.8 after 9 days \(early signal\)/);
  const solid = evalAt(SOLID_DAYS, row(6.8));
  assert.equal(solid.confidence, "solid");
  assert.doesNotMatch(solid.headline, /early signal/);
});

test("position getting worse is a regression", () => {
  const o = evalAt(14, row(13));
  assert.equal(o.status, "regressed");
  assert.match(o.headline, /Got worse: position 11\.0 → 13\.0/);
});

test("a small move with no click change is unchanged, never over-claimed", () => {
  assert.equal(evalAt(14, row(10.6)).status, "unchanged");
});

test("same position but clearly more clicks counts as improved, clearly fewer as worse", () => {
  assert.equal(evalAt(14, row(11, 1000, 45)).status, "improved");
  assert.equal(evalAt(14, row(11, 1000, 20)).status, "regressed");
});

test("an improvement does not count if the search nearly vanished", () => {
  assert.notEqual(evalAt(14, row(5, 300, 5)).status, "improved");
});

test("snippet rewrites are judged on click rate, not position", () => {
  const rec = record({ position: 2, ctr: 0.012, clicks: 12, impressions: 1000 });
  const better = evalAt(14, row(2, 1000, 45), "rewrite_snippet", rec);
  assert.equal(better.status, "improved");
  assert.match(better.headline, /Click rate 1\.2% → 4\.5%/);
  assert.equal(evalAt(14, row(2, 1000, 5), "rewrite_snippet", rec).status, "regressed");
  assert.equal(evalAt(14, row(2, 1000, 13), "rewrite_snippet", rec).status, "unchanged");
});

test("too few views before the change means no verdict instead of noise", () => {
  const o = evalAt(14, row(3), "improve_content_relevance", record({ impressions: MIN_BASELINE_IMPRESSIONS - 1 }));
  assert.equal(o.status, "no_data");
  assert.match(o.headline, /too few to measure/);
});

test("no current data says so", () => {
  const o = evalAt(14, null);
  assert.equal(o.status, "no_data");
  assert.match(o.headline, /No recent data/);
});

test("a fix with no baseline (not a search finding) is not measured", () => {
  const o = evalAt(14, row(5), "improve_content_relevance", { ...record(), baseline: null });
  assert.equal(o.status, "no_data");
  assert.match(o.headline, /isn't measured/);
});

test("the same readout works for a GitHub PR as for a manual change", () => {
  const manual = evalAt(14, row(6.8));
  const viaPr = evalAt(14, row(6.8), "improve_content_relevance", record({}, { via: "github_pr", change: { prUrl: "https://github.com/o/r/pull/7", summary: "Title and H1" } }));
  assert.equal(viaPr.status, manual.status);
  assert.equal(viaPr.headline, manual.headline);
  assert.equal(viaPr.via, "github_pr");
});

function payloadWith(rows: SnapshotQuery[]): SearchSnapshotPayload {
  const r = snapshotRanges(new Date("2026-10-01T00:00:00Z"));
  return {
    version: 1, capturedAt: "2026-10-01T00:00:00.000Z", siteUrl: "s",
    windows: { d7: { ...r.d7, queries: [] }, d28: { ...r.d28, queries: rows.map((q) => ({ ...q, rankingPages: [] })) }, d90: { ...r.d90, queries: [] }, prev28: { ...r.prev28, queries: [] } },
  } as unknown as SearchSnapshotPayload;
}

function opportunityFinding(type: OpportunityType = "ranking") {
  const opp: SearchOpportunity = { type, query: "Best SEO Tool", pageUrl: null, score: 1, reasons: ["r"], metrics: { clicks: 20, impressions: 900, ctr: 20 / 900, position: 9 }, previous: null };
  return findingForOpportunity(opp, { projectId: "p", brand: null, capturedAt: "2026-09-30T00:00:00.000Z" });
}

test("baselineFor prefers the latest snapshot's numbers over the numbers at flag time", () => {
  const evidence = opportunityEvidenceOf(opportunityFinding().evidence)!;
  const fromSnapshot = baselineFor(evidence, { snapshotDate: "2026-10-01", payload: payloadWith([row(11, 1000, 30, "best seo tool")]) }, T0);
  assert.equal(fromSnapshot.source, "snapshot");
  assert.equal(fromSnapshot.position, 11);
  const fromFinding = baselineFor(evidence, null, T0);
  assert.equal(fromFinding.source, "finding");
  assert.equal(fromFinding.position, 9);
  assert.equal(fromFinding.impressions, 900);
});

test("buildImplementation records via, time and baseline; non-search findings get no baseline", () => {
  const finding = opportunityFinding();
  const rec = buildImplementation({ finding, snapshot: { snapshotDate: "2026-10-01", payload: payloadWith([row(11)]) }, now: T0 });
  assert.equal(rec.via, "manual");
  assert.equal(rec.implementedAt, T0.toISOString());
  assert.equal(rec.baseline?.position, 11);

  const pr = buildImplementation({ finding, snapshot: null, via: "github_pr", now: T0, change: { prUrl: "https://github.com/o/r/pull/7" } });
  assert.equal(pr.via, "github_pr");
  assert.equal(pr.change?.prUrl, "https://github.com/o/r/pull/7");

  assert.equal(buildImplementation({ finding: { evidence: { page: {} } }, snapshot: null, now: T0 }).baseline, null);
});

test("implementationOf reads a saved record and ignores malformed ones", () => {
  const rec = record();
  assert.deepEqual(implementationOf({ implementation: rec }), rec);
  assert.equal(implementationOf(null), null);
  assert.equal(implementationOf({}), null);
  assert.equal(implementationOf({ implementation: { implementedAt: "not a date" } }), null);
  assert.equal(implementationOf({ implementation: { implementedAt: T0.toISOString(), baseline: { query: 5 } } })?.baseline, null);
  assert.equal(implementationOf({ implementation: { implementedAt: T0.toISOString(), via: "weird" } })?.via, "manual");
});

test("outcomeForAction ties it together and is null until the change is marked done", () => {
  const finding = opportunityFinding();
  const action = { type: "improve_content_relevance" as const, result: { implementation: record() } as Record<string, unknown> };
  const snapshot = { snapshotDate: "2026-10-15", payload: payloadWith([row(6.8, 1100, 50, "best seo tool")]) };
  const o = outcomeForAction({ action, finding, snapshot, now: later(14) });
  assert.equal(o?.status, "improved");
  assert.equal(outcomeForAction({ action: { ...action, result: null }, finding, snapshot, now: later(14) }), null);
  assert.equal(outcomeForAction({ action, finding, snapshot: null, now: later(14) })?.status, "no_data");
});

test("a snippet rewrite whose page is unchanged is 'not applied', not a fake 'no change'", () => {
  const rec = record({ position: 2, ctr: 0.012, clicks: 12 });
  const o = evaluateOutcome({
    implementation: rec, actionType: "rewrite_snippet", current: row(2, 1000, 12), now: later(14),
    pageChange: { changed: false, changes: [] },
  });
  assert.equal(o.status, "not_applied");
  assert.match(o.headline, /couldn't see a change/);
});

test("page proof is shown as a note, and an unchanged page never overrides measured movement for other fixes", () => {
  const changed = evaluateOutcome({
    implementation: record(), actionType: "improve_content_relevance", current: row(6.8), now: later(14),
    pageChange: { changed: true, changes: [{ field: "title", before: "Old", after: "New" }, { field: "h1", before: "a", after: "b" }] },
  });
  assert.equal(changed.status, "improved");
  assert.match(changed.pageNote ?? "", /title was “Old”, now “New” \(\+1 more\)/);

  const unchanged = evaluateOutcome({
    implementation: record(), actionType: "improve_content_relevance", current: row(6.8), now: later(14),
    pageChange: { changed: false, changes: [] },
  });
  assert.equal(unchanged.status, "improved", "other content may have changed");
  assert.match(unchanged.pageNote ?? "", /Ignore this if you edited other content/);
});

test("a solid, judged verdict is worth saving; waiting and no-data are not", async () => {
  const { shouldSaveOutcome, savedOutcomeOf } = await import("../lib/domain/search/actionOutcome.ts");
  assert.equal(shouldSaveOutcome(evalAt(14, row(6.8))), true);
  assert.equal(shouldSaveOutcome(evalAt(9, row(6.8))), false, "early signal can still move");
  assert.equal(shouldSaveOutcome(evalAt(3, row(6.8))), false);
  assert.equal(shouldSaveOutcome(evalAt(14, null)), false);
  const saved = { ...evalAt(14, row(6.8)), evaluatedAt: "2026-10-15T00:00:00Z" };
  assert.equal(savedOutcomeOf({ outcome: saved })?.status, "improved");
  assert.equal(savedOutcomeOf({ outcome: { status: "improved" } }), null);
  assert.equal(savedOutcomeOf(null), null);
});

test("a saved verdict is final: later numbers do not change it", () => {
  const finding = opportunityFinding();
  const saved = { ...evalAt(14, row(6.8)), evaluatedAt: "2026-10-15T00:00:00Z" };
  const action = { type: "improve_content_relevance" as const, result: { implementation: record(), outcome: saved } as Record<string, unknown> };
  const now = outcomeForAction({ action, finding, snapshot: { snapshotDate: "2026-12-01", payload: payloadWith([row(20, 50, 1, "best seo tool")]) }, now: later(60) });
  assert.equal(now?.status, "improved");
});
