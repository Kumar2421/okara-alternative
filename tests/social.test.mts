import { test } from "node:test";
import assert from "node:assert";
import { getPlatformConfig, listPlatforms } from "../lib/domain/social/platforms.ts";

test("platform configs are defined", () => {
  const platforms = listPlatforms();
  assert.strictEqual(platforms.length, 3, "should have 3 platforms");
  assert.strictEqual(platforms[0].id, "x");
  assert.strictEqual(platforms[1].id, "linkedin");
  assert.strictEqual(platforms[2].id, "reddit");
});

test("X platform config", () => {
  const config = getPlatformConfig("x");
  assert.strictEqual(config.maxBodyChars, 280);
  assert.strictEqual(config.id, "x");
  assert.strictEqual(config.name, "X (Twitter)");
});

test("LinkedIn platform config", () => {
  const config = getPlatformConfig("linkedin");
  assert.strictEqual(config.maxBodyChars, 3000);
  assert.strictEqual(config.id, "linkedin");
  assert.strictEqual(config.name, "LinkedIn");
});

test("Reddit platform config", () => {
  const config = getPlatformConfig("reddit");
  assert.strictEqual(config.maxBodyChars, 40000);
  assert.strictEqual(config.maxTitleChars, 300);
  assert.strictEqual(config.id, "reddit");
  assert.strictEqual(config.name, "Reddit");
});

test("X compose URL", () => {
  const config = getPlatformConfig("x");
  const url = config.composeUrl({ text: "Hello world" });
  assert(url.includes("x.com/intent/post"));
  assert(url.includes("text=Hello%20world"));
});

test("LinkedIn compose URL", () => {
  const config = getPlatformConfig("linkedin");
  const url = config.composeUrl({ text: "Hello world" });
  assert(url.includes("linkedin.com/feed"));
  assert(url.includes("text=Hello%20world"));
});

test("Reddit compose URL", () => {
  const config = getPlatformConfig("reddit");
  const url = config.composeUrl({ subreddit: "test", title: "Test Title", text: "Test body" });
  assert(url.includes("reddit.com/r/test/submit"));
  assert(url.includes("title=Test%20Title"));
  assert(url.includes("text=Test%20body"));
});

test("Reddit compose URL strips r/ prefix", () => {
  const config = getPlatformConfig("reddit");
  const url = config.composeUrl({ subreddit: "r/test", title: "Title", text: "body" });
  assert(url.includes("/r/test/submit"));
});

test("character count validation for X", () => {
  const config = getPlatformConfig("x");
  assert(280 <= config.maxBodyChars);
  assert(281 > config.maxBodyChars);
});

test("character count validation for Reddit", () => {
  const config = getPlatformConfig("reddit");
  assert(300 <= (config.maxTitleChars ?? 0));
  assert(40000 <= config.maxBodyChars);
});
