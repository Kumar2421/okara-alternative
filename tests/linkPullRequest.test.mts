import test from "node:test";
import assert from "node:assert/strict";
import type { Action } from "../lib/domain/actions/actionTypes.ts";
import { linkPullRequest, pullRequestUrlOf } from "../lib/domain/fixes/linkPullRequest.ts";

const action = (over: Partial<Action>): Action =>
  ({ id: "a1", status: "approved", result: null, target: {}, findingId: "f1", ...over }) as Action;

test("links the PR to open actions only, once", () => {
  const links = linkPullRequest(
    [action({ id: "open" }), action({ id: "done", status: "completed" }), action({ id: "has", result: { pullRequest: { url: "u" } } })],
    "https://github.com/o/r/pull/1",
  );
  assert.deepEqual(links.map((l) => l.id), ["open"]);
  assert.equal(pullRequestUrlOf(links[0].result), "https://github.com/o/r/pull/1");
});

