import test from "node:test";
import assert from "node:assert/strict";
import { createAction, transitionAction, type ActionRepository } from "../lib/domain/actions/actionService.ts";
import type { Action } from "../lib/domain/actions/actionTypes.ts";

function makeAction(status: Action["status"] = "proposed"): Action {
  return {
    id: "action_1", projectId: "project_1", findingId: "finding_1", recommendationId: "finding_1:noindex",
    type: "remove_noindex", status, title: "Remove noindex", target: { url: "https://example.com/page" },
    parameters: {}, result: null, createdAt: "2026-01-01T00:00:00.000Z", startedAt: null, completedAt: null,
  };
}

function repository(initial: Action) {
  let current = initial;
  const repo: ActionRepository = {
    get: () => current,
    list: () => [current],
    create: (input) => {
      current = { ...current, ...input, id: "action_new", status: "proposed", result: null, createdAt: current.createdAt, startedAt: null, completedAt: null };
      return current;
    },
    transition: (_projectId, _id, status, result = null) => {
      current = { ...current, status, result };
      return current;
    },
  };
  return { repo, get current() { return current; } };
}

test("creates proposed actions through the service boundary", async () => {
  const state = repository(makeAction());
  const action = await createAction(state.repo, {
    projectId: "project_1", findingId: "finding_1", recommendationId: "finding_1:noindex",
    type: "remove_noindex", title: "Remove noindex", target: { url: "https://example.com/page" }, parameters: {},
  });
  assert.equal(action.status, "proposed");
});

test("enforces action lifecycle transitions", async () => {
  const state = repository(makeAction());
  await transitionAction(state.repo, "project_1", "action_1", "approved");
  await transitionAction(state.repo, "project_1", "action_1", "running");
  await transitionAction(state.repo, "project_1", "action_1", "completed", { ok: true });
  assert.equal(state.current.status, "completed");
  await assert.rejects(() => transitionAction(state.repo, "project_1", "action_1", "running"), /Invalid action status transition/);
});
