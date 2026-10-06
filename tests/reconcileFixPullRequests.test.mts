import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFixPullRequests } from "../lib/domain/fixes/reconcileFixPullRequests.ts";
import { fixDeliveryFake } from "../lib/domain/fixes/fixDeliveryFake.ts";
import { implementationOf } from "../lib/domain/search/actionOutcome.ts";
import type { OutcomePorts } from "../lib/domain/search/outcomeService.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";

const T0 = new Date("2026-10-01T00:00:00Z");

let actionCounter = 0;

function makeAction(prUrl: string | null = null, status: Action["status"] = "proposed"): Action {
  const result = prUrl
    ? {
        implementation: {
          via: "manual" as const,
          change: { prUrl },
          implementedAt: T0.toISOString(),
        },
      }
    : null;
  const id = `a${++actionCounter}`;
  return {
    id,
    projectId: "p",
    findingId: "f1",
    type: "manual_fix",
    status,
    title: "Fix something",
    target: {},
    parameters: {},
    result,
    createdAt: T0.toISOString(),
    startedAt: null,
    completedAt: status === "completed" ? T0.toISOString() : null,
  };
}

function makeFinding(id = "f1"): Finding {
  return {
    id,
    projectId: "p",
    source: "seo",
    category: "test",
    severity: "warning",
    entityType: "page",
    entityId: "test",
    url: "https://example.com/test",
    evidence: {},
    recommendation: "Test",
    status: "new",
    firstSeen: T0.toISOString(),
    lastSeen: T0.toISOString(),
    resolvedAt: null,
  };
}

function harness(opts: { actions?: Action[]; finding?: Finding } = {}) {
  const actions = opts.actions ?? [];
  const finding = opts.finding ?? makeFinding();
  const ports: OutcomePorts = {
    projectUrl: "https://example.com",
    getAction: async (id) => {
      return actions.find((a) => a.id === id) ?? null;
    },
    getFinding: async () => finding,
    getSnapshot: async () => null,
    completeAction: async (id, result) => {
      const action = actions.find((a) => a.id === id);
      if (!action) return null;
      action.status = "completed";
      action.completedAt = new Date().toISOString();
      action.result = result;
      return action;
    },
    saveResult: async () => {},
    resetAction: async () => null,
    moveFinding: async () => {},
    fetchFingerprint: async () => null,
  };
  const fixDelivery = fixDeliveryFake();
  return { ports, fixDelivery, actions };
}

test("reconcileFixPullRequests: merged PR gets marked as implemented", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");

  const prUrl = "https://github.com/o/r/pull/1";
  const action = h.actions[0];

  // Verify extractPrUrl works
  const extracted = action.result && typeof action.result === "object"
    ? (action.result as Record<string, unknown>)["implementation"]
      ? ((action.result as Record<string, unknown>)["implementation"] as Record<string, unknown>)["change"]
        ? (((action.result as Record<string, unknown>)["implementation"] as Record<string, unknown>)["change"] as Record<string, unknown>)["prUrl"]
        : null
      : null
    : null;
  assert.equal(extracted, prUrl, "extractPrUrl should find the PR URL");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  const actionAfter = h.actions[0];
  assert.equal(actionAfter.status, "completed", "action should be marked completed");
  const impl = implementationOf(actionAfter.result);
  assert.equal(impl?.via, "github_pr");
  assert.equal(impl?.change?.prUrl, "https://github.com/o/r/pull/1");
});

test("reconcileFixPullRequests: open PR is not marked as implemented", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "open");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  const action = h.actions[0];
  assert.equal(action.status, "proposed");
});

test("reconcileFixPullRequests: closed PR is not marked as implemented", async () => {
  const h = harness({
    actions: [makeAction("https://github.com/o/r/pull/1")],
  });
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "closed");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  const action = h.actions[0];
  assert.equal(action.status, "proposed");
});

test("reconcileFixPullRequests: idempotent; merged PR marked again stays completed", async () => {
  const h = harness();
  const action = makeAction("https://github.com/o/r/pull/1");
  h.actions.push(action);
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);
  assert.equal(h.actions[0].status, "completed");

  // Run again
  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);
  assert.equal(h.actions[0].status, "completed");
});

test("reconcileFixPullRequests: skips actions already implemented via github_pr", async () => {
  const h = harness();
  const action = makeAction("https://github.com/o/r/pull/1", "completed");
  action.result = {
    implementation: {
      via: "github_pr",
      change: { prUrl: "https://github.com/o/r/pull/1" },
      implementedAt: T0.toISOString(),
    },
  };
  h.actions.push(action);
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");

  const originalResult = action.result;
  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  // Should not change anything (already implemented via GitHub)
  assert.deepEqual(action.result, originalResult);
  assert.equal(action.status, "completed");
});

test("reconcileFixPullRequests: skips actions with no PR URL", async () => {
  const h = harness({
    actions: [makeAction(null)],
  });

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(h.actions[0].status, "proposed");
});

test("reconcileFixPullRequests: skips completed/failed/cancelled actions", async () => {
  const h = harness();
  const actions: Array<{ status: Action["status"]; action: Action }> = [];
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const action = makeAction("https://github.com/o/r/pull/1", status);
    actions.push({ status, action });
    h.actions.push(action);
  }
  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  // Verify that actions with non-proposed/approved status are left untouched
  for (const { status, action } of actions) {
    assert.equal(action.status, status, `${status} action should not be changed`);
  }
});

test("reconcileFixPullRequests: one failing action doesn't block others", async () => {
  const h = harness();
  const action1 = makeAction("https://github.com/o/r/pull/1");
  const action2 = makeAction("https://github.com/o/r/pull/2");
  h.actions.push(action1, action2);

  // Simulate failure for action1 by id
  const originalGetAction = h.ports.getAction;
  h.ports.getAction = async (id) => {
    if (id === action1.id) throw new Error("Database error");
    return originalGetAction(id);
  };

  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");
  h.fixDelivery.setState("https://github.com/o/r/pull/2", "merged");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  // Action 1 should fail and not block action 2
  assert.equal(h.actions[0].status, "proposed");
  assert.equal(h.actions[1].status, "completed");
});

test("reconcileFixPullRequests: handles multiple actions with different PR states", async () => {
  const h = harness();
  h.actions.push(
    makeAction("https://github.com/o/r/pull/1"),
    makeAction("https://github.com/o/r/pull/2"),
    makeAction("https://github.com/o/r/pull/3")
  );

  h.fixDelivery.setState("https://github.com/o/r/pull/1", "merged");
  h.fixDelivery.setState("https://github.com/o/r/pull/2", "open");
  h.fixDelivery.setState("https://github.com/o/r/pull/3", "closed");

  await reconcileFixPullRequests(h.ports, h.fixDelivery, h.actions);

  assert.equal(h.actions[0].status, "completed");
  assert.equal(h.actions[1].status, "proposed");
  assert.equal(h.actions[2].status, "proposed");
});
