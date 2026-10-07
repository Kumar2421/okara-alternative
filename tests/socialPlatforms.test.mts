import test from "node:test";
import assert from "node:assert/strict";
import { getPlatformConfig, listPlatforms } from "../lib/domain/social/platforms.ts";

test("platform registry has x, linkedin, and reddit", () => {
  const platforms = listPlatforms();
  assert.equal(platforms.length, 3);
  const ids = new Set(platforms.map((p) => p.id));
  assert.ok(ids.has("x"));
  assert.ok(ids.has("linkedin"));
  assert.ok(ids.has("reddit"));
});

test("x platform: 280 char limit, compose URL via twitter.com intent", () => {
  const x = getPlatformConfig("x");
  assert.equal(x.maxBodyChars, 280);
  assert.ok(!x.maxTitleChars);
  const url = x.composeUrl({ text: "Hello world" });
  assert.match(url, /^https:\/\/x\.com\/intent\/post\?text=/);
  assert.match(url, /Hello%20world/);
});

test("linkedin platform: 3000 char limit, compose URL via linkedin.com", () => {
  const linkedin = getPlatformConfig("linkedin");
  assert.equal(linkedin.maxBodyChars, 3000);
  assert.ok(!linkedin.maxTitleChars);
  const url = linkedin.composeUrl({ text: "Career insight" });
  assert.match(url, /^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/);
  assert.match(url, /Career%20insight/);
});

test("reddit platform: 40000 body + 300 title limits, compose URL with subreddit", () => {
  const reddit = getPlatformConfig("reddit");
  assert.equal(reddit.maxBodyChars, 40000);
  assert.equal(reddit.maxTitleChars, 300);
  const url = reddit.composeUrl({ subreddit: "startups", title: "New startup", text: "Check this out" });
  assert.match(url, /^https:\/\/www\.reddit\.com\/r\/startups\/submit/);
  assert.match(url, /title=New%20startup/);
  assert.match(url, /text=Check%20this%20out/);
});

test("reddit compose URL handles missing subreddit gracefully", () => {
  const reddit = getPlatformConfig("reddit");
  const url = reddit.composeUrl({ title: "Test", text: "Body" });
  assert.match(url, /^https:\/\/www\.reddit\.com\/r\/\/submit/);
});

test("compose URLs encode special characters correctly", () => {
  const x = getPlatformConfig("x");
  const url = x.composeUrl({ text: "Hello & welcome\nline #2?" });
  assert.match(url, /Hello%20%26%20welcome%0Aline%20%232%3F/);
});
