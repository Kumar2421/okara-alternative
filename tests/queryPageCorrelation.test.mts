import test from "node:test";
import assert from "node:assert/strict";
import { attachRankingPages } from "../lib/domain/analytics/queryPageCorrelation.ts";

const opportunity = (query: string, score = 100) => ({
  query,
  clicks: 20,
  impressions: 500,
  ctr: 0.04,
  position: 8,
  score,
});

const pageRow = (
  query: string,
  url: string,
  impressions: number,
  clicks: number,
  position: number
) => ({
  keys: [query, url],
  impressions,
  clicks,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position,
});

test("attaches ranking pages ordered by impressions", () => {
  const result = attachRankingPages(
    [opportunity("seo audit")],
    [
      pageRow("seo audit", "https://example.com/guide", 900, 45, 7),
      pageRow("seo audit", "https://example.com/pricing", 300, 10, 10),
    ]
  );

  assert.deepEqual(result[0]?.rankingPages.map((page) => page.url), [
    "https://example.com/guide",
    "https://example.com/pricing",
  ]);
});

test("aggregates repeated query-page rows", () => {
  const result = attachRankingPages(
    [opportunity("technical seo")],
    [
      pageRow("technical seo", "https://example.com/technical", 100, 5, 6),
      pageRow("technical seo", "https://example.com/technical", 300, 21, 10),
    ]
  );

  const page = result[0]?.rankingPages[0];
  assert.equal(page?.impressions, 400);
  assert.equal(page?.clicks, 26);
  assert.equal(page?.ctr, 26 / 400);
  assert.equal(page?.position, 9);
});

test("limits ranking pages to three and ignores invalid dimensions", () => {
  const rows = [
    pageRow("query", "https://example.com/a", 500, 20, 8),
    pageRow("query", "https://example.com/b", 400, 20, 9),
    pageRow("query", "https://example.com/c", 300, 20, 10),
    pageRow("query", "https://example.com/d", 200, 20, 11),
    pageRow("query", "", 1000, 100, 5),
    pageRow("", "https://example.com/ignored", 1000, 100, 5),
  ];

  const result = attachRankingPages([opportunity("query")], rows);

  assert.deepEqual(result[0]?.rankingPages.map((page) => page.url), [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ]);
});

test("keeps opportunities without matching page rows", () => {
  const result = attachRankingPages([opportunity("missing")], []);
  assert.deepEqual(result[0]?.rankingPages, []);
});
