import test from "node:test";
import assert from "node:assert/strict";
import { deriveRecommendations } from "../lib/domain/recommendations/recommendationRules.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

function makeFinding(evidence: Record<string, unknown>): Finding {
  return {
    id: "finding_1", projectId: "project_1", source: "search-console", category: "search-visibility",
    severity: "critical", entityType: "query", entityId: "example query", url: "https://example.com/page",
    evidence, recommendation: "Fix the issue.", status: "new",
    firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z", resolvedAt: null,
  };
}

test("derives one recommendation per detected issue", () => {
  const recommendations = deriveRecommendations(makeFinding({ page: { meta: { indexable: false }, contentRelevance: { keywordRelevance: 20 }, serverTiming: { ttfbMs: 3000 } } }));
  assert.deepEqual(recommendations.map((item) => item.type), ["noindex", "missing_canonical", "low_keyword_relevance", "slow_ttfb"]);
  assert.equal(recommendations[0]?.priority, "high");
});

test("keeps healthy pages recommendation-free", () => {
  const recommendations = deriveRecommendations(makeFinding({ page: { meta: { indexable: true, canonical: "https://example.com/page" }, contentRelevance: { keywordRelevance: 50 }, serverTiming: { ttfbMs: 1500 } } }));
  assert.deepEqual(recommendations, []);
});

test("uses finding identity as the stable recommendation target", () => {
  const recommendations = deriveRecommendations(makeFinding({ page: { meta: { indexable: true }, contentRelevance: { keywordRelevance: 45 } } }));
  assert.equal(recommendations[0]?.id, "finding_1:low_keyword_relevance");
  assert.equal(recommendations[0]?.target.query, "example query");
  assert.equal(recommendations[0]?.target.url, "https://example.com/page");
});
