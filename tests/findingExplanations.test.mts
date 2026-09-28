import test from "node:test";
import assert from "node:assert/strict";
import { explainFinding } from "../lib/domain/seo/findingExplanations.ts";

test("explains a known issueId with evidence-grounded copy", () => {
  const result = explainFinding({ issueId: "meta-title-too-long", evidence: { current: "x".repeat(80), length: 80 } });
  assert.match(result.whyItMatters, /60 characters/);
  assert.match(result.whyItMatters, /80/);
  assert.ok(result.recommendation.length > 0);
});

test("includes concrete values from evidence, not generic text", () => {
  const result = explainFinding({ issueId: "heading-h1-multiple", evidence: { h1Count: 3 } });
  assert.match(result.whyItMatters, /3/);
});

test("falls back to an honest generic explanation for an unknown issueId", () => {
  const result = explainFinding({ issueId: "some-future-issue", evidence: {} });
  assert.ok(result.whyItMatters.length > 0);
  assert.ok(result.recommendation.length > 0);
});

test("never returns empty strings for any known issueId", () => {
  const issueIds = [
    "robots-txt-disallow",
    "meta-title-missing",
    "meta-title-too-long",
    "meta-description-missing",
    "meta-description-too-long",
    "canonical-missing",
    "heading-h1-missing",
    "heading-h1-multiple",
    "heading-order-skip",
    "og-tags-missing",
    "og-tags-partial",
    "twitter-tags-missing",
  ];
  for (const issueId of issueIds) {
    const result = explainFinding({ issueId, evidence: {} });
    assert.ok(result.whyItMatters.length > 0, `${issueId} missing whyItMatters`);
    assert.ok(result.recommendation.length > 0, `${issueId} missing recommendation`);
  }
});
