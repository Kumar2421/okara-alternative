import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSeoAuditRecheck } from "../lib/domain/seo/reconcileRecheck.ts";

type Finding = {
  issueId: string;
  category: string;
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
};

function finding(overrides: Partial<Finding>): Finding {
  return {
    issueId: "meta-title-too-long",
    category: "meta-title",
    severity: "Warning",
    label: "Meta title too long (> 60 chars)",
    evidence: { current: "x".repeat(80), length: 80 },
    autoFixable: true,
    ...overrides,
  };
}

test("marks the finding resolved when its issueId is no longer present", () => {
  const result = reconcileSeoAuditRecheck("meta-title-too-long", [], "warning");
  assert.equal(result.issueDetected, false);
  assert.equal(result.severity, "warning");
  assert.match(result.recommendation, /no longer detected/);
});

test("marks the finding still failing when the same issueId reappears", () => {
  const fresh = [finding({})];
  const result = reconcileSeoAuditRecheck("meta-title-too-long", fresh, "warning");
  assert.equal(result.issueDetected, true);
  assert.equal(result.severity, "warning");
  assert.match(result.recommendation, /60 characters/);
});

test("does not resolve a finding just because a DIFFERENT issue is present", () => {
  // Reproduces the bug: the old recheck evaluated one hardcoded rule
  // regardless of which issue was actually being rechecked. A fresh crawl
  // that still has other issues, but not this one, must still resolve it.
  const fresh = [finding({ issueId: "og-tags-missing", category: "og-tags", label: "Missing Open Graph tags" })];
  const result = reconcileSeoAuditRecheck("meta-title-too-long", fresh, "warning");
  assert.equal(result.issueDetected, false);
});

test("maps SEOAgent Error severity to critical", () => {
  const fresh = [finding({ issueId: "heading-h1-missing", severity: "Error", label: "No H1 tag found" })];
  const result = reconcileSeoAuditRecheck("heading-h1-missing", fresh, "critical");
  assert.equal(result.severity, "critical");
});
