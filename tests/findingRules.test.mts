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
