import test from "node:test";
import assert from "node:assert/strict";
import { isNoSubredditError, clampVariants } from "../lib/domain/social/errorDetection.ts";

test("isNoSubredditError detects exact message", () => {
  const error = new Error("Specify a subreddit or configure one in Settings.");
  assert.strictEqual(isNoSubredditError(error), true);
});

test("isNoSubredditError detects message as substring", () => {
  const error = new Error("Something happened: Specify a subreddit or configure one in Settings. Please try again.");
  assert.strictEqual(isNoSubredditError(error), true);
});

test("isNoSubredditError rejects different error message", () => {
  const error = new Error("Connect a free Groq key in Settings, then try again.");
  assert.strictEqual(isNoSubredditError(error), false);
});

test("isNoSubredditError handles non-Error objects", () => {
  assert.strictEqual(isNoSubredditError(null), false);
  assert.strictEqual(isNoSubredditError(undefined), false);
  assert.strictEqual(isNoSubredditError("plain string"), false);
  assert.strictEqual(isNoSubredditError({}), false);
});

test("clampVariants clamps below 1", () => {
  assert.strictEqual(clampVariants(0), 1);
  assert.strictEqual(clampVariants(-5), 1);
});

test("clampVariants clamps above 3", () => {
  assert.strictEqual(clampVariants(4), 3);
  assert.strictEqual(clampVariants(10), 3);
});

test("clampVariants allows valid values", () => {
  assert.strictEqual(clampVariants(1), 1);
  assert.strictEqual(clampVariants(2), 2);
  assert.strictEqual(clampVariants(3), 3);
});

test("clampVariants uses default 3 for undefined", () => {
  assert.strictEqual(clampVariants(undefined), 3);
});

test("clampVariants floors decimal values", () => {
  assert.strictEqual(clampVariants(2.9), 2);
  assert.strictEqual(clampVariants(1.1), 1);
});
