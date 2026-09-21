import test from "node:test";
import assert from "node:assert/strict";
import { deriveSearchFinding } from "../lib/domain/findings/findingRules.ts";

const base = {
  meta: { title: "Example", canonical: "https://example.com/page", indexable: true },
  contentRelevance: { keywordRelevance: 80 },
  serverTiming: { ttfbMs: 500 },
};

test("creates a warning finding for missing canonical or slow TTFB", () => {
  const result = deriveSearchFinding({
    ...base,
    meta: { ...base.meta, canonical: undefined },
    serverTiming: { ttfbMs: 2000 },
  });
  assert.equal(result?.severity, "warning");
  assert.match(result?.recommendation ?? "", /canonical/);
  assert.match(result?.recommendation ?? "", /TTFB/);
});

test("creates a critical finding for noindex or very low relevance", () => {
  const result = deriveSearchFinding({
    ...base,
    meta: { ...base.meta, indexable: false },
    contentRelevance: { keywordRelevance: 80 },
  });
  assert.equal(result?.severity, "critical");
});

test("returns no finding when evidence is healthy", () => {
  assert.equal(deriveSearchFinding(base), null);
});


test("does not flag threshold values that are exactly healthy", () => {
  assert.equal(
    deriveSearchFinding({
      ...base,
      contentRelevance: { keywordRelevance: 50 },
      serverTiming: { ttfbMs: 1500 },
    }),
    null,
  );
});

test("treats very low relevance as critical", () => {
  const result = deriveSearchFinding({
    ...base,
    contentRelevance: { keywordRelevance: 29.9 },
  });
  assert.equal(result?.severity, "critical");
});

test("combines all detected issues into one deterministic recommendation", () => {
  const result = deriveSearchFinding({
    meta: { title: "Example", canonical: undefined, indexable: false },
    contentRelevance: { keywordRelevance: 20 },
    serverTiming: { ttfbMs: 2000 },
  });

  assert.equal(result?.severity, "critical");
  assert.match(result?.recommendation ?? "", /noindex/i);
  assert.match(result?.recommendation ?? "", /canonical/i);
  assert.match(result?.recommendation ?? "", /keyword relevance/i);
  assert.match(result?.recommendation ?? "", /TTFB/i);
});
