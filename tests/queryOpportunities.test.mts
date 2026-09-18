import test from "node:test";
import assert from "node:assert/strict";
import { findQueryOpportunities } from "../lib/domain/analytics/queryOpportunities.ts";

const row = (
  query: string,
  position: number,
  impressions: number,
  ctr: number,
  clicks = Math.round(impressions * ctr)
) => ({
  keys: [query],
  position,
  impressions,
  ctr,
  clicks,
});

test("returns only queries in positions 4–15 with at least 100 impressions", () => {
  const result = findQueryOpportunities([
    row("position 3", 3, 500, 0.02),
    row("position 4", 4, 500, 0.02),
    row("position 15", 15, 500, 0.02),
    row("position 16", 16, 500, 0.02),
    row("low impressions", 8, 99, 0.02),
  ]);

  assert.deepEqual(
    result.map((item) => item.query).sort(),
    ["position 15", "position 4"]
  );
});

test("prioritizes larger opportunities and caps the result at eight rows", () => {
  const rows = Array.from({ length: 12 }, (_, index) =>
    row(`query ${index}`, 4 + (index % 4), 100 + index * 100, 0.01)
  );

  const result = findQueryOpportunities(rows);

  assert.equal(result.length, 8);
  assert.equal(result[0]?.query, "query 10");
  assert.ok(result.every((item) => item.score >= 0));
});

test("uses deterministic tie-breakers", () => {
  const result = findQueryOpportunities([
    row("zeta", 8, 500, 0.1),
    row("alpha", 8, 500, 0.1),
  ]);

  assert.deepEqual(result.map((item) => item.query), ["alpha", "zeta"]);
});

test("clamps invalid CTR values before calculating the score", () => {
  const result = findQueryOpportunities([
    row("negative ctr", 8, 500, -0.5),
    row("high ctr", 8, 500, 1.5),
  ]);

  assert.equal(result.length, 2);
  assert.ok(result[0]!.score >= result[1]!.score);
});

test("ignores blank queries", () => {
  const result = findQueryOpportunities([row("   ", 8, 500, 0.1)]);

  assert.deepEqual(result, []);
});
