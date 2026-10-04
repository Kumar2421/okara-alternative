import test from "node:test";
import assert from "node:assert/strict";
import { compareWindows, summarizeChanges } from "../lib/domain/search/searchDelta.ts";
import { buildOpportunities, expectedCtr } from "../lib/domain/search/searchOpportunities.ts";
import { findQueryOpportunities } from "../lib/domain/analytics/queryOpportunities.ts";
import { snapshotRanges, TOP_QUERIES_MAIN, TOP_QUERIES_OTHER, type SearchSnapshotPayload, type SnapshotQuery } from "../lib/domain/search/searchSnapshot.ts";

function q(query: string, impressions: number, clicks: number, position: number): SnapshotQuery {
  return { query, impressions, clicks, ctr: impressions ? clicks / impressions : 0, position };
}

const withPage = (query: SnapshotQuery, url: string) => ({ ...query, rankingPages: [{ url, clicks: 0, impressions: 0, ctr: 0, position: 0 }] });

function payload(current: SnapshotQuery[], previous: SnapshotQuery[]): SearchSnapshotPayload {
  const ranges = snapshotRanges(new Date("2026-10-10T00:00:00Z"));
  const empty = { ...ranges.d7, queries: [] };
  return {
    version: 1,
    capturedAt: "2026-10-10T00:00:00.000Z",
    siteUrl: "sc-domain:example.com",
    windows: {
      d7: empty,
      d28: { ...ranges.d28, queries: current.map((c) => ({ ...c, rankingPages: (c as { rankingPages?: [] }).rankingPages ?? [] })) },
      d90: { ...ranges.d90, queries: [] },
      prev28: { ...ranges.prev28, queries: previous },
    },
  };
}

const trendOf = (changes: ReturnType<typeof compareWindows>, query: string) => changes.find((c) => c.query === query)?.trend;

test("compareWindows: position worsening by 2+ places is down, improving is up, small moves are stable", () => {
  const changes = compareWindows(
    [q("down", 500, 10, 10), q("up", 500, 10, 5), q("flat", 500, 10, 8.5)],
    [q("down", 500, 10, 7), q("up", 500, 10, 8), q("flat", 500, 10, 8)],
  );
  assert.equal(trendOf(changes, "down"), "down");
  assert.equal(trendOf(changes, "up"), "up");
  assert.equal(trendOf(changes, "flat"), "stable");
});

test("compareWindows: a 30%+ drop in views is declining even when position held", () => {
  const changes = compareWindows([q("a", 600, 10, 8)], [q("a", 1000, 10, 8)]);
  assert.equal(trendOf(changes, "a"), "down");
  assert.equal(changes[0].impressionsChange, -400);
  assert.equal(changes[0].positionChange, 0);
});

test("compareWindows: low-volume queries never register as trending", () => {
  const changes = compareWindows([q("tiny", 60, 1, 20)], [q("tiny", 90, 1, 5)]);
  assert.equal(trendOf(changes, "tiny"), "stable");
});

test("compareWindows: new and lost need minimum volume", () => {
  const changes = compareWindows(
    [q("fresh", 300, 5, 12), q("blip", 20, 0, 30)],
    [q("gone", 800, 20, 4), q("faint", 10, 0, 40)],
  );
  assert.equal(trendOf(changes, "fresh"), "new");
  assert.equal(trendOf(changes, "blip"), "stable");
  assert.equal(trendOf(changes, "gone"), "lost");
  assert.equal(trendOf(changes, "faint"), "stable");
});

test("compareWindows: a truncated previous list cannot prove a query is new", () => {
  // Previous list is full (cap) with smallest entry at 100 views. A query with 90 views now could
  // have been cut from it, so it is not "new"; one with 400 views clearly was not hidden there.
  const previous = Array.from({ length: TOP_QUERIES_OTHER }, (_, i) => q(`p${i}`, 100 + i, 1, 9));
  const changes = compareWindows([q("maybe", 90, 1, 9), q("surely", 400, 1, 9)], previous);
  assert.equal(trendOf(changes, "maybe"), "stable");
  assert.equal(trendOf(changes, "surely"), "new");
});

test("compareWindows: a truncated current list cannot prove a query is lost", () => {
  const current = Array.from({ length: TOP_QUERIES_MAIN }, (_, i) => q(`c${i}`, 100 + i, 1, 9));
  const changes = compareWindows(current, [q("below", 80, 1, 9), q("above", 900, 10, 4)]);
  assert.equal(trendOf(changes, "below"), "stable");
  assert.equal(trendOf(changes, "above"), "lost");
});

test("compareWindows handles empty windows and summarizes only real changes", () => {
  assert.deepEqual(compareWindows([], []), []);
  const changes = compareWindows(
    [q("up", 500, 1, 3), q("new1", 200, 1, 9), q("same", 500, 1, 8)],
    [q("up", 500, 1, 8), q("lost1", 300, 1, 5), q("same", 500, 1, 8)],
  );
  assert.deepEqual(summarizeChanges(changes), { up: 1, down: 0, new: 1, lost: 1 });
});

test("expectedCtr falls as position worsens", () => {
  assert.ok(expectedCtr(1) > expectedCtr(2));
  assert.ok(expectedCtr(2) > expectedCtr(3));
  assert.ok(expectedCtr(3) > expectedCtr(3.8));
});

test("buildOpportunities: ranking group is identical to the existing live scoring", () => {
  const current = [q("a", 1240, 30, 8.2), q("b", 500, 5, 12), q("c", 90, 1, 9), q("d", 2000, 400, 2)];
  const result = buildOpportunities(payload(current, []));
  const expected = findQueryOpportunities(current.map((c) => ({ keys: [c.query], clicks: c.clicks, impressions: c.impressions, ctr: c.ctr, position: c.position })));
  assert.deepEqual(result.ranking.map((o) => o.query), expected.map((o) => o.query));
  assert.deepEqual(result.ranking.map((o) => o.score), expected.map((o) => Number(o.score.toFixed(2))));
});

test("buildOpportunities: every opportunity explains itself and carries metrics", () => {
  const current = [withPage(q("a", 1240, 30, 8.2), "https://example.com/a"), q("fresh", 300, 5, 12), q("top", 1000, 10, 1.2)];
  const result = buildOpportunities(payload(current, [q("gone", 800, 20, 4)]));
  const all = [...result.ranking, ...result.ctr, ...result.declining, ...result.newQueries, ...result.lostQueries];
  assert.ok(all.length >= 4);
  for (const item of all) {
    assert.ok(item.reasons.length >= 2, `${item.type}:${item.query} has reasons`);
    assert.ok(item.score > 0);
    assert.equal(typeof item.metrics.impressions, "number");
  }
  assert.equal(result.ranking[0].pageUrl, "https://example.com/a");
  assert.match(result.ranking[0].reasons[0], /1,240/);
});

test("buildOpportunities: CTR group flags well-ranked, under-clicked queries only", () => {
  const result = buildOpportunities(
    payload([q("weak snippet", 1000, 20, 2), q("healthy", 1000, 200, 2), q("too small", 50, 0, 1), q("low rank", 1000, 5, 9)], []),
  );
  assert.deepEqual(result.ctr.map((o) => o.query), ["weak snippet"]);
});

test("buildOpportunities: declining, new and lost groups with before/after", () => {
  const result = buildOpportunities(
    payload(
      [q("slipping", 600, 12, 11), q("fresh", 400, 8, 10)],
      [q("slipping", 900, 40, 6), q("gone", 700, 30, 5)],
    ),
  );
  assert.equal(result.declining[0].query, "slipping");
  assert.deepEqual(result.declining[0].previous?.position, 6);
  assert.match(result.declining[0].reasons[0], /6\.0 to 11\.0/);
  assert.equal(result.newQueries[0].query, "fresh");
  assert.equal(result.lostQueries[0].query, "gone");
  assert.equal(result.lostQueries[0].pageUrl, null);
  assert.deepEqual(result.changes, { up: 0, down: 1, new: 1, lost: 1 });
});

test("buildOpportunities: groups are capped and ordered by score then name deterministically", () => {
  const many = Array.from({ length: 30 }, (_, i) => q(`q${String(i).padStart(2, "0")}`, 1000, 2, 2));
  const result = buildOpportunities(payload(many, []));
  assert.equal(result.ctr.length, 5);
  assert.deepEqual(result.ctr.map((o) => o.query), ["q00", "q01", "q02", "q03", "q04"]);
});

test("buildOpportunities on an empty snapshot returns empty groups", () => {
  const result = buildOpportunities(payload([], []));
  assert.deepEqual(result, { ranking: [], ctr: [], declining: [], newQueries: [], lostQueries: [], changes: { up: 0, down: 0, new: 0, lost: 0 } });
});
