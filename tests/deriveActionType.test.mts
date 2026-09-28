import test from "node:test";
import assert from "node:assert/strict";
import { deriveActionType } from "../lib/domain/actions/deriveActionType.ts";

test("maps canonical-missing SEO-audit findings to add_canonical", () => {
  const type = deriveActionType({ source: "seo-audit", entityId: "canonical-missing", evidence: {} });
  assert.equal(type, "add_canonical");
});

test("falls back to manual_fix for every other SEO-audit issueId", () => {
  const type = deriveActionType({ source: "seo-audit", entityId: "meta-title-too-long", evidence: {} });
  assert.equal(type, "manual_fix");
});

test("maps analytics findings by evidence, mirroring recommendationRules conditions", () => {
  assert.equal(
    deriveActionType({ source: "search-console", entityId: "q1", evidence: { page: { meta: { indexable: false, canonical: "https://x" } } } }),
    "remove_noindex",
  );
  assert.equal(
    deriveActionType({ source: "search-console", entityId: "q2", evidence: { page: { meta: { indexable: true, canonical: null } } } }),
    "add_canonical",
  );
  assert.equal(
    deriveActionType({ source: "search-console", entityId: "q3", evidence: { page: { meta: { indexable: true, canonical: "https://x" }, contentRelevance: { keywordRelevance: 30 } } } }),
    "improve_content_relevance",
  );
  assert.equal(
    deriveActionType({ source: "search-console", entityId: "q4", evidence: { page: { meta: { indexable: true, canonical: "https://x" }, contentRelevance: { keywordRelevance: 80 }, serverTiming: { ttfbMs: 2000 } } } }),
    "investigate_ttfb",
  );
});

test("falls back to manual_fix when an analytics finding matches no known condition", () => {
  const type = deriveActionType({
    source: "search-console",
    entityId: "q5",
    evidence: { page: { meta: { indexable: true, canonical: "https://x" }, contentRelevance: { keywordRelevance: 80 }, serverTiming: { ttfbMs: 200 } } },
  });
  assert.equal(type, "manual_fix");
});
