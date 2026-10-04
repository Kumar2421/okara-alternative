import test from "node:test";
import assert from "node:assert/strict";
import { deriveLeadTarget, pickRole } from "../lib/domain/leads/leadTarget.ts";

const base = { productInfo: null, category: "SEO software", name: "Marlo" };

const STRATEGY = `
# Marketing Strategy

## Positioning
We help teams win search.

## Ideal Customer Profile (ICP)
- Industry: B2B SaaS
- Location: India
- Decision makers: Heads of Marketing and Founders at 10-200 person companies
- Growth marketers who own SEO and content

## Channels
CEO outreach is not our focus.
`;

test("reads buyer roles, industry and location from the ICP section", () => {
  const t = deriveLeadTarget({ ...base, marketingStrategy: STRATEGY });
  assert.equal(t.source, "marketing-strategy");
  assert.ok(t.roles.includes("Head of Marketing"), JSON.stringify(t.roles));
  assert.ok(t.roles.some((r) => /founder/i.test(r)));
  assert.equal(t.industry, "B2B SaaS");
  assert.equal(t.location, "India");
});

test("only looks inside the ICP section, not the whole document", () => {
  const t = deriveLeadTarget({ ...base, marketingStrategy: STRATEGY });
  assert.ok(!t.roles.some((r) => /^ceo$/i.test(r)), "a CEO mention under another heading is ignored");
});

test("falls back to Product Info when the strategy has no usable ICP", () => {
  const t = deriveLeadTarget({
    ...base,
    marketingStrategy: "# Strategy\n\nJust positioning here.",
    productInfo: "## Target audience\nVP Marketing and Head of Growth at SaaS startups.",
  });
  assert.equal(t.source, "product-info");
  assert.ok(t.roles.some((r) => /^VP Marketing$/i.test(r)));
});

test("falls back to the project category when no ICP is written down", () => {
  const t = deriveLeadTarget({ ...base, marketingStrategy: null });
  assert.deepEqual(t, { roles: [], industry: "SEO software", location: "", source: "category" });
});

test("falls back to the project name when there is no category either", () => {
  const t = deriveLeadTarget({ marketingStrategy: null, productInfo: null, category: "  ", name: "Marlo" });
  assert.equal(t.industry, "Marlo");
});

test("an ICP section without any recognisable title does not count", () => {
  const t = deriveLeadTarget({ ...base, marketingStrategy: "## ICP\nSmall businesses that need help.\n" });
  assert.equal(t.source, "category");
});

test("uses a known industry term when the doc has no 'Industry:' label", () => {
  const t = deriveLeadTarget({ ...base, marketingStrategy: "## Target audience\nFounders of e-commerce brands.\n" });
  assert.equal(t.source, "marketing-strategy");
  assert.match(t.industry, /e-?commerce/i);
});

test("returns at most three roles, most mentioned first", () => {
  const t = deriveLeadTarget({
    ...base,
    marketingStrategy: "## ICP\nFounders, founders, founders. CTOs and CMOs and Heads of Product and VP Sales.\n",
  });
  assert.ok(t.roles.length <= 3);
  assert.equal(t.roles[0], "Founder");
});

test("pickRole rotates daily and handles an empty list", () => {
  const roles = ["Founder", "CMO", "VP Marketing"];
  const a = pickRole(roles, new Date("2026-10-10T08:00:00Z"));
  const b = pickRole(roles, new Date("2026-10-11T08:00:00Z"));
  const c = pickRole(roles, new Date("2026-10-12T08:00:00Z"));
  assert.equal(new Set([a, b, c]).size, 3, "three consecutive days cover three roles");
  assert.equal(pickRole(roles, new Date("2026-10-10T23:59:00Z")), a, "same day, same role");
  assert.equal(pickRole([], new Date()), "");
});
