import test from "node:test";
import assert from "node:assert/strict";
import { applyRecheck, transitionFinding, type FindingRepository } from "../lib/domain/findings/findingService.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

function makeFinding(status: Finding["status"] = "new"): Finding {
  return {
    id: "finding_1",
    projectId: "project_1",
    source: "search-console",
    category: "search-visibility",
    severity: "warning",
    entityType: "query",
    entityId: "example query",
    url: "https://example.com/page",
    evidence: {},
    recommendation: "Fix the issue.",
    status,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
  };
}

function repository(initial: Finding): { repo: FindingRepository; current: Finding } {
  let current = initial;
  const repo: FindingRepository = {
    get: () => current,
    list: () => [current],
    transition: (_projectId, _id, status) => {
      current = { ...current, status };
      return current;
    },
    refresh: (_projectId, _id, input) => {
      current = { ...current, ...input };
      return current;
    },
  };
  return { repo, get current() { return current; } };
}

test("finding service enforces lifecycle transitions before persistence", async () => {
  const state = repository(makeFinding("new"));

  const updated = await transitionFinding(state.repo, "project_1", "finding_1", "acknowledged");
  assert.equal(updated?.status, "acknowledged");

  await assert.rejects(
    () => transitionFinding(state.repo, "project_1", "finding_1", "verified"),
    /Invalid finding status transition: acknowledged -> verified/,
  );
});

test("recheck marks an unresolved finding failed", async () => {
  const state = repository(makeFinding("fixing"));

  const updated = await applyRecheck(state.repo, "project_1", "finding_1", {
    severity: "critical",
    evidence: { issue: true },
    recommendation: "Fix it again.",
    issueDetected: true,
  });

  assert.equal(updated?.status, "failed");
  assert.equal(updated?.severity, "critical");
  assert.deepEqual(updated?.evidence, { issue: true });
});

test("recheck marks a resolved finding verified", async () => {
  const state = repository(makeFinding("fixed"));

  const updated = await applyRecheck(state.repo, "project_1", "finding_1", {
    severity: "warning",
    evidence: { issue: false },
    recommendation: "Issue no longer detected.",
    issueDetected: false,
  });

  assert.equal(updated?.status, "verified");
  assert.equal(updated?.resolvedAt, null);
});
