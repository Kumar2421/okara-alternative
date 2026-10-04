import test from "node:test";
import assert from "node:assert/strict";
import { countFindings, findingTitle, pagePath } from "../lib/domain/findings/findingDisplay.ts";

test("findingTitle prefers the audit label", () => {
  assert.equal(findingTitle({ evidence: { label: "  Missing meta description " }, recommendation: "Add one. It helps." }), "Missing meta description");
});

test("findingTitle falls back to the first sentence of the recommendation", () => {
  assert.equal(findingTitle({ evidence: {}, recommendation: "Add a canonical tag. Search engines then pick the right page." }), "Add a canonical tag.");
  assert.equal(findingTitle({ evidence: { label: "   " }, recommendation: "Fix the title" }), "Fix the title");
});

test("findingTitle never returns an empty title", () => {
  assert.equal(findingTitle({ evidence: {}, recommendation: "" }), "Untitled finding");
});

test("pagePath shows just the path", () => {
  assert.equal(pagePath("https://example.com/blog/post?x=1#top"), "/blog/post");
  assert.equal(pagePath("https://example.com"), "/");
  assert.equal(pagePath(null), "No page");
  assert.equal(pagePath("not a url"), "not a url");
});

test("countFindings: verified no longer needs attention, severities count only open findings", () => {
  const counts = countFindings([
    { severity: "critical", status: "new" },
    { severity: "critical", status: "verified" },
    { severity: "warning", status: "fixing" },
    { severity: "warning", status: "failed" },
    { severity: "info", status: "acknowledged" },
  ]);
  assert.deepEqual(counts, { needsAttention: 4, critical: 1, warning: 2, verified: 1 });
});

test("countFindings on nothing", () => {
  assert.deepEqual(countFindings([]), { needsAttention: 0, critical: 0, warning: 0, verified: 0 });
});
