import test from "node:test";
import assert from "node:assert/strict";
import { classifyFinding, isCodeFixable, isSafeRepoPath, plannedTargets, type FindingLike } from "../lib/domain/codefix/fixCatalog.ts";

const seo = (entityId: string): FindingLike => ({ source: "seo-audit", category: "x", entityId, evidence: {} });

const AUTO_SEO: Array<[string, string[]]> = [
  ["meta-title-missing", ["title"]],
  ["meta-title-too-long", ["title"]],
  ["meta-description-missing", ["meta_description"]],
  ["meta-description-too-long", ["meta_description"]],
  ["canonical-missing", ["canonical"]],
  ["og-tags-missing", ["open_graph"]],
  ["og-tags-partial", ["open_graph"]],
  ["twitter-tags-missing", ["twitter_card"]],
  ["lighthouse-desktop-image-alt", ["alt_text"]],
  ["lighthouse-mobile-image-alt", ["alt_text"]],
  ["sitemap-missing", ["sitemap"]],
];

for (const [id, kinds] of AUTO_SEO) {
  test(`seo-audit ${id} is auto`, () => {
    const c = classifyFinding(seo(id));
    assert.equal(c.mode, "auto");
    if (c.mode === "auto") assert.deepEqual(c.kinds, kinds);
  });
}

for (const id of ["heading-h1-missing", "heading-h1-multiple", "heading-order-skip", "robots-txt-disallow", "lighthouse-desktop-render-blocking-resources", "lighthouse-mobile-unused-javascript", "something-new"]) {
  test(`seo-audit ${id} is manual`, () => {
    const c = classifyFinding(seo(id));
    assert.equal(c.mode, "manual");
    assert.equal(isCodeFixable(seo(id)), false);
    if (c.mode === "manual") assert.match(c.reason, /manual/i);
  });
}

test("GEO readiness items: llms.txt and JSON-LD / FAQ schema are auto", () => {
  const geo = (entityId: string, category = "readiness"): FindingLike => ({ source: "geo", category, entityId, evidence: {} });
  assert.deepEqual((classifyFinding(geo("llms-txt-missing")) as { kinds: string[] }).kinds, ["llms_txt"]);
  assert.deepEqual((classifyFinding(geo("json-ld-missing")) as { kinds: string[] }).kinds, ["json_ld"]);
  assert.deepEqual((classifyFinding(geo("faq-schema-missing")) as { kinds: string[] }).kinds, ["faq_schema"]);
  assert.deepEqual((classifyFinding(geo("structured-data-and-llms")) as { kinds: string[] }).kinds, ["llms_txt", "json_ld"]);
  assert.equal(classifyFinding(geo("brand-mentions-low")).mode, "manual");
});

test("search-console: CTR opportunities rewrite title and description; ranking shifts are manual", () => {
  const ctr: FindingLike = { source: "search-console", entityId: "ctr:q", evidence: { opportunity: { type: "ctr" } } };
  const c = classifyFinding(ctr);
  assert.equal(c.mode, "auto");
  assert.deepEqual((c as { kinds: string[] }).kinds, ["title", "meta_description"]);
  for (const type of ["declining", "lost_query", "ranking", "new_query"]) {
    assert.equal(isCodeFixable({ source: "search-console", entityId: "x", evidence: { opportunity: { type } } }), false);
  }
});

test("search-console page evidence: missing canonical is auto, noindex stays manual", () => {
  const base = (meta: Record<string, unknown>): FindingLike => ({ source: "search-console", entityId: "q", evidence: { page: { meta } } });
  assert.equal(isCodeFixable(base({ indexable: true })), true);
  assert.equal(isCodeFixable(base({ indexable: true, canonical: "https://x.com" })), false);
  assert.equal(isCodeFixable(base({ indexable: false })), false);
});

test("unknown sources are manual", () => {
  assert.equal(isCodeFixable({ source: "mystery", entityId: "meta-title-missing" }), false);
});

test("plannedTargets splits page edits from new files", () => {
  assert.deepEqual(plannedTargets(["llms_txt", "json_ld"]), { pageKinds: ["json_ld"], newFileKinds: ["llms_txt"] });
});

test("isSafeRepoPath blocks traversal, hidden, CI and secret paths", () => {
  for (const ok of ["app/page.tsx", "public/llms.txt", "src/pages/[slug].tsx", "llms.txt", "public/.well-known/x.txt"]) assert.equal(isSafeRepoPath(ok), true, ok);
  for (const bad of ["", "/etc/passwd", "../x", "a/../b", ".github/workflows/ci.yml", ".env", "app/.env.local", "node_modules/x/y.js", "a\\b", "keys/server.pem", "a//b", "x y"]) {
    assert.equal(isSafeRepoPath(bad), false, bad);
  }
});
