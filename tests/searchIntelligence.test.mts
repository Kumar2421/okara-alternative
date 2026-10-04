import test from "node:test";
import assert from "node:assert/strict";
import { brandTermsFrom, classifyQuery, normalizeQuery } from "../lib/domain/search/searchIntent.ts";
import { clusterQueries } from "../lib/domain/search/queryClustering.ts";
import { buildSearchInsights, MAX_ANALYSED_QUERIES } from "../lib/domain/search/searchInsights.ts";
import type { ClassifiedQuery, QueryRow } from "../lib/domain/search/types.ts";

function row(query: string, impressions: number, clicks = 0, position = 8): QueryRow {
  return { keys: [query], impressions, clicks, ctr: impressions ? clicks / impressions : 0, position };
}

function cq(query: string, impressions: number, clicks = 0, position = 8): ClassifiedQuery {
  const { intent, signals } = classifyQuery(query);
  return { query, intent, signals, impressions, clicks, position };
}

test("normalizeQuery lowercases, strips punctuation and collapses whitespace", () => {
  assert.equal(normalizeQuery("  Best   SEO-Tools, for Startups!  "), "best seo tools for startups");
  assert.equal(normalizeQuery(""), "");
});

test("normalizeQuery keeps non-latin letters", () => {
  assert.equal(normalizeQuery("Café Preise"), "café preise");
});

for (const [query, intent] of [
  ["best seo tool for startups", "recommendation"],
  ["ahrefs alternative", "alternative"],
  ["seo tool alternatives", "alternative"],
  ["marlo vs semrush", "comparison"],
  ["seo tools comparison", "comparison"],
  ["seo tool pricing", "pricing"],
  ["is semrush free", "pricing"],
  ["semrush reviews", "review"],
  ["how to fix seo errors", "how_to"],
  ["canonical tag not working", "problem"],
  ["crm for agencies", "audience"],
  ["seo software", "commercial"],
  ["what is a canonical url", "informational"],
] as const) {
  test(`classifyQuery: "${query}" → ${intent}`, () => {
    assert.equal(classifyQuery(query).intent, intent);
  });
}

test("classifyQuery reports every matched signal, primary first", () => {
  const result = classifyQuery("best cheap seo tool for agencies");
  assert.equal(result.intent, "recommendation");
  assert.deepEqual(result.signals, ["recommendation", "pricing", "audience", "commercial"]);
});

test("classifyQuery falls back to informational", () => {
  assert.deepEqual(classifyQuery("canonical url"), { intent: "informational", signals: ["informational"] });
});

test("classifyQuery does not match intent words inside other words", () => {
  // "freedom" contains "free", "toolbox" contains "tool"; neither is intent.
  assert.equal(classifyQuery("freedom of speech").intent, "informational");
  assert.equal(classifyQuery("woodworking toolbox").intent, "informational");
});

test("classifyQuery prioritises brand over everything else", () => {
  const result = classifyQuery("marlo vs semrush pricing", ["marlo"]);
  assert.equal(result.intent, "brand");
  assert.deepEqual(result.signals.slice(0, 3), ["brand", "comparison", "pricing"]);
});

test("classifyQuery brand matches a word or a compacted long domain label", () => {
  assert.equal(classifyQuery("marlo login", ["marlo"]).intent, "brand");
  // People often type a joined brand with a space.
  assert.equal(classifyQuery("okara alternative pricing", ["okaraalternative"]).intent, "brand");
  assert.equal(classifyQuery("okaraalternative", ["okaraalternative"]).intent, "brand");
  // Short terms must not match inside other words.
  assert.equal(classifyQuery("marlowe poems", ["marlo"]).intent, "informational");
});

test("brandTermsFrom combines project name words and domain label", () => {
  assert.deepEqual(brandTermsFrom("Marlo SEO", "https://www.marlo.ai/"), ["marlo", "seo"]);
});

test("brandTermsFrom uses the registrable label for subdomains and co.uk-style domains", () => {
  assert.deepEqual(brandTermsFrom(null, "https://app.marlo.ai"), ["marlo"]);
  assert.deepEqual(brandTermsFrom(null, "acme.co.uk"), ["acme"]);
  assert.deepEqual(brandTermsFrom("Acme", "https://acme.com"), ["acme"]);
});

test("brandTermsFrom ignores short words and tolerates bad input", () => {
  assert.deepEqual(brandTermsFrom("AI", null), []);
  assert.deepEqual(brandTermsFrom(undefined, "not a url at all"), []);
  assert.deepEqual(brandTermsFrom("", ""), []);
});

test("clusterQueries groups the same topic across wording and synonyms", () => {
  const themes = clusterQueries([
    cq("best seo tool for startups", 400, 20),
    cq("seo tools for startups", 300, 10),
    cq("seo software for saas startups", 120, 2),
    cq("canonical url guide", 90, 1),
  ]);
  assert.equal(themes.length, 2);
  assert.equal(themes[0].label, "best seo tool for startups");
  assert.equal(themes[0].queries, 3);
  assert.equal(themes[0].impressions, 820);
  assert.equal(themes[0].clicks, 32);
  assert.equal(themes[1].label, "canonical url guide");
});

test("clusterQueries computes impression-weighted position and CTR", () => {
  const [theme] = clusterQueries([cq("seo tools", 300, 30, 4), cq("best seo tool", 100, 0, 12)]);
  assert.equal(theme.queries, 2);
  assert.equal(theme.ctr, 30 / 400);
  assert.equal(theme.position, (4 * 300 + 12 * 100) / 400);
});

test("clusterQueries keeps a broader query out of a narrower audience-specific theme", () => {
  const themes = clusterQueries([
    cq("seo tools for startups", 300),
    cq("seo tool pricing", 200),
  ]);
  assert.equal(themes.length, 2);
});

test("clusterQueries does not merge unrelated topics", () => {
  const themes = clusterQueries([cq("seo tools", 100), cq("email marketing tools", 90)]);
  assert.equal(themes.length, 2);
});

test("clusterQueries is deterministic regardless of input order", () => {
  const input = [cq("seo tools for startups", 300), cq("best seo tool for startups", 400), cq("crm software", 50)];
  assert.deepEqual(clusterQueries(input), clusterQueries([...input].reverse()));
});

test("clusterQueries handles empty input and keeps at most 3 examples", () => {
  assert.deepEqual(clusterQueries([]), []);
  const [theme] = clusterQueries([
    cq("seo tool", 50), cq("seo tools", 40), cq("seo software", 30), cq("seo platform", 20),
  ]);
  assert.equal(theme.queries, 4);
  assert.equal(theme.examples.length, 3);
});

test("clusterQueries names a theme made only of modifiers instead of dropping it", () => {
  const themes = clusterQueries([cq("best", 10)]);
  assert.equal(themes.length, 1);
  assert.equal(themes[0].label, "best");
});

test("buildSearchInsights summarises intents with shares that sum to 1", () => {
  const insights = buildSearchInsights(
    [row("marlo login", 100, 40, 1), row("best seo tool", 300, 10), row("ahrefs alternative", 100, 5)],
    ["marlo"],
  );
  assert.equal(insights.analysedQueries, 3);
  assert.deepEqual(insights.intents.map((i) => i.intent), ["recommendation", "brand", "alternative"]);
  assert.equal(insights.intents[0].share, 0.6);
  assert.ok(Math.abs(insights.intents.reduce((sum, i) => sum + i.share, 0) - 1) < 1e-9);
});

test("buildSearchInsights skips blank queries and zero-impression rows", () => {
  const insights = buildSearchInsights([row("  ", 100), row("seo tool", 0), row("seo tool", 50)]);
  assert.equal(insights.analysedQueries, 1);
});

test("buildSearchInsights on no data returns empty insight", () => {
  assert.deepEqual(buildSearchInsights([]), { analysedQueries: 0, intents: [], themes: [] });
});

test("buildSearchInsights caps analysed queries to the highest-impression ones", () => {
  const rows = Array.from({ length: MAX_ANALYSED_QUERIES + 50 }, (_, i) => row(`topic${i} widget`, 1000 - i));
  const insights = buildSearchInsights(rows);
  assert.equal(insights.analysedQueries, MAX_ANALYSED_QUERIES);
  assert.ok(insights.themes.length <= 8);
});
