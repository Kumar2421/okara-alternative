import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionFinding, FINDING_TRANSITIONS } from "../lib/domain/findings/findingTypes.ts";

test("finding lifecycle allows the intended forward transitions", () => {
  assert.equal(canTransitionFinding("new", "acknowledged"), true);
  assert.equal(canTransitionFinding("acknowledged", "fixing"), true);
  assert.equal(canTransitionFinding("fixing", "fixed"), true);
  assert.equal(canTransitionFinding("fixed", "verified"), true);
  assert.equal(canTransitionFinding("failed", "fixing"), true);
});

test("finding lifecycle rejects invalid jumps", () => {
  assert.equal(canTransitionFinding("new", "fixed"), false);
  assert.equal(canTransitionFinding("acknowledged", "verified"), false);
  assert.equal(canTransitionFinding("verified", "fixed"), false);
  assert.equal(canTransitionFinding("fixing", "verified"), false);
});

test("every status has an explicit transition definition", () => {
  assert.deepEqual(Object.keys(FINDING_TRANSITIONS).sort(), [
    "acknowledged", "failed", "fixed", "fixing", "new", "verified",
  ]);
});
