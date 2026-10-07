import { test } from "node:test";
import * as assert from "node:assert";
import { summaryTotals } from "../lib/domain/search/summaryTotals.ts";
import type { SnapshotWindow } from "../lib/domain/search/searchSnapshot.ts";

test("summaryTotals - sums clicks and impressions", () => {
  const window: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "search 1", clicks: 50, impressions: 1000, ctr: 0.05, position: 2 },
      { query: "search 2", clicks: 30, impressions: 500, ctr: 0.06, position: 3 },
    ],
  };

  const totals = summaryTotals(window);

  assert.strictEqual(totals.clicks, 80, "should sum clicks");
  assert.strictEqual(totals.impressions, 1500, "should sum impressions");
});

test("summaryTotals - calculates impressions-weighted average position", () => {
  const window: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "search 1", clicks: 50, impressions: 1000, ctr: 0.05, position: 2 },
      { query: "search 2", clicks: 50, impressions: 1000, ctr: 0.05, position: 4 },
    ],
  };

  const totals = summaryTotals(window);

  // (2*1000 + 4*1000) / 2000 = 6000 / 2000 = 3
  assert.strictEqual(totals.position, 3, "should use impressions-weighted average");
});

test("summaryTotals - handles empty window", () => {
  const window: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [],
  };

  const totals = summaryTotals(window);

  assert.strictEqual(totals.clicks, 0);
  assert.strictEqual(totals.impressions, 0);
  assert.strictEqual(totals.position, 0);
});

test("summaryTotals - handles null window", () => {
  const totals = summaryTotals(null);

  assert.strictEqual(totals.clicks, 0);
  assert.strictEqual(totals.impressions, 0);
  assert.strictEqual(totals.position, 0);
});

test("summaryTotals - guards divide-by-zero", () => {
  const window: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "no clicks", clicks: 0, impressions: 0, ctr: 0, position: 2 },
    ],
  };

  const totals = summaryTotals(window);

  assert.strictEqual(totals.position, 0, "should not divide by zero");
});

test("summaryTotals - accepts simplified query objects", () => {
  const simplified = {
    queries: [
      { clicks: 50, impressions: 1000, position: 2 },
      { clicks: 30, impressions: 500, position: 3 },
    ],
  };

  const totals = summaryTotals(simplified);

  assert.strictEqual(totals.clicks, 80);
  assert.strictEqual(totals.impressions, 1500);
  // (2*1000 + 3*500) / 1500 = 3500 / 1500 = 2.333...
  assert.ok(Math.abs(totals.position - 2.3333) < 0.01, "should handle simplified objects");
});
