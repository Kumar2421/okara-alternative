import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLinkedInDraft,
  parseLinkedInBatch,
  parseRedditDraft,
  parseRedditBatch,
} from "../lib/domain/social/draftParse.ts";

// LinkedIn draft tests
test("parseLinkedInDraft accepts valid hook line and body", () => {
  const r = parseLinkedInDraft({
    hookLine: "Three lessons from scaling our product in the first year",
    body: "Building in public taught us that shipping fast beats perfection. Direct feedback from users shaped every decision. And we learned to celebrate small wins.",
    angle: "Insight",
    whyThisWorks: "Founders love actionable advice.",
  });
  assert.ok(r.ok);
  assert.equal(r.value.hookLine, "Three lessons from scaling our product in the first year");
  assert.match(r.value.body, /Building in public/);
});

test("parseLinkedInDraft rejects empty or missing fields", () => {
  assert.equal(parseLinkedInDraft(null).ok, false);
  assert.equal(parseLinkedInDraft({ hookLine: "" }).ok, false);
  assert.equal(parseLinkedInDraft({ body: "" }).ok, false);
  assert.equal(parseLinkedInDraft({ hookLine: "test" }).ok, false);
});

test("parseLinkedInDraft enforces 100-3000 character total limit", () => {
  const shortDraft = { hookLine: "a", body: "b" };
  assert.equal(parseLinkedInDraft(shortDraft).ok, false, "too short (2 chars)");

  const goodDraft = { hookLine: "a".repeat(50), body: "b".repeat(50) };
  assert.equal(parseLinkedInDraft(goodDraft).ok, true, "100 chars");

  const longDraft = { hookLine: "a".repeat(2000), body: "b".repeat(1500) };
  assert.equal(parseLinkedInDraft(longDraft).ok, false, "over 3000 chars");
});

test("parseLinkedInBatch handles fenced JSON and multiple formats", () => {
  const good = {
    drafts: [
      { hookLine: "First key insight from building this product is crucial", body: "The experience taught us everything changes when real users engage" },
      { hookLine: "First key insight from building this product is crucial", body: "The experience taught us everything changes when real users engage" }, // duplicate
      { hookLine: "Second lesson we learned is important for founders", body: "Shipping fast and iterating beats waiting for perfection always" },
    ],
  };
  const fenced = parseLinkedInBatch("```json\n" + JSON.stringify(good) + "\n```");
  assert.equal(fenced.drafts.length, 2, "dedupes by hook+body");
  assert.ok(fenced.errors.length >= 0);
});

test("parseLinkedInBatch caps at 3 drafts", () => {
  const drafts = Array.from({ length: 6 }, (_, i) => ({
    hookLine: `Hook number ${i} with some additional text to meet minimum`,
    body: `Body number ${i} with more content to ensure we meet the hundred character minimum requirement for LinkedIn drafts`,
  }));
  const result = parseLinkedInBatch(JSON.stringify({ drafts }));
  assert.equal(result.drafts.length, 3);
});

// Reddit draft tests
test("parseRedditDraft accepts valid subreddit, title, and body", () => {
  const r = parseRedditDraft({
    subreddit: "startups",
    title: "Building our first SaaS",
    body: "We just launched our product on Product Hunt.",
    angle: "Launch story",
    whyThisWorks: "Community loves founder stories.",
  });
  assert.ok(r.ok);
  assert.equal(r.value.subreddit, "startups");
  assert.equal(r.value.title, "Building our first SaaS");
});

test("parseRedditDraft validates subreddit format (2-21 alphanumeric + underscore)", () => {
  assert.equal(parseRedditDraft({ subreddit: "a", title: "t", body: "b" }).ok, false, "subreddit too short");
  assert.equal(parseRedditDraft({ subreddit: "abc123", title: "t", body: "b" }).ok, true, "valid");
  assert.equal(parseRedditDraft({ subreddit: "abc-def", title: "t", body: "b" }).ok, false, "hyphen invalid");
  assert.equal(parseRedditDraft({ subreddit: "a".repeat(22), title: "t", body: "b" }).ok, false, "too long");
  assert.equal(parseRedditDraft({ subreddit: "abc_def_123", title: "t", body: "b" }).ok, true, "underscore valid");
});

test("parseRedditDraft enforces title and body limits", () => {
  const longTitle = { subreddit: "test", title: "a".repeat(301), body: "b" };
  assert.equal(parseRedditDraft(longTitle).ok, false, "title over 300");

  const longBody = { subreddit: "test", title: "t", body: "b".repeat(40001) };
  assert.equal(parseRedditDraft(longBody).ok, false, "body over 40000");

  const valid = { subreddit: "test", title: "a".repeat(300), body: "b".repeat(40000) };
  assert.equal(parseRedditDraft(valid).ok, true);
});

test("parseRedditBatch deduplicates and caps at 3", () => {
  const drafts = [
    { subreddit: "startups", title: "Post 1", body: "Body 1" },
    { subreddit: "startups", title: "Post 1", body: "Body 1" }, // duplicate
    { subreddit: "startups", title: "Post 2", body: "Body 2" },
    { subreddit: "startups", title: "Post 3", body: "Body 3" },
    { subreddit: "startups", title: "Post 4", body: "Body 4" },
  ];
  const result = parseRedditBatch(JSON.stringify({ drafts }));
  assert.equal(result.drafts.length, 3, "caps at 3");
  assert.deepEqual(
    result.drafts.map((d) => d.title),
    ["Post 1", "Post 2", "Post 3"]
  );
});

test("parseRedditBatch handles invalid JSON gracefully", () => {
  assert.equal(parseRedditBatch("not json").drafts.length, 0);
  assert.ok(parseRedditBatch("not json").errors.length > 0);
  assert.equal(parseRedditBatch("[]").drafts.length, 0);
  assert.ok(parseRedditBatch("[]").errors.length > 0);
});

test("both batches handle prose mixed with JSON", () => {
  const json = {
    drafts: [{
      hookLine: "Here is a meaningful hook about our product launch strategy",
      body: "This comprehensive body explains the reasoning behind every decision made during our launch and what we learned",
    }],
  };
  const li = parseLinkedInBatch("Here's your draft:\n```json\n" + JSON.stringify(json) + "\n```");
  assert.equal(li.drafts.length, 1);

  const reddit = parseRedditBatch("Reddit posts incoming:\n" + JSON.stringify({
    drafts: [{ subreddit: "startups", title: "My First SaaS Launch Story", body: "Building and launching a product was challenging but rewarding. I learned valuable lessons about customer feedback and iteration throughout the process." }],
  }));
  assert.equal(reddit.drafts.length, 1);
});
