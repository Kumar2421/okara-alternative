import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  buildDraftPrompt, countTweetChars, intentUrl, isWithinLimit, parseDraft, parseDraftBatch, MAX_TWEET_CHARS,
} from "../lib/domain/x/draftPost.ts";
import { dailyDraftBatchLimit } from "../lib/domain/x/xDraftTypes.ts";
import { countXBatchesSince, deleteXDraft, ensureXDraftColumns, insertXDrafts, listXDrafts, updateXDraft } from "../lib/domain/x/xDraftStore.ts";

test("parseDraft accepts a valid draft and defaults the angle", () => {
  const r = parseDraft({ text: " Line one\nLine two ", whyThisWorks: "Short and concrete.", angle: "" });
  assert.ok(r.ok);
  assert.equal(r.value.text, "Line one\nLine two");
  assert.equal(r.value.angle, "General");
});

test("parseDraft rejects empty, non-object and over-limit text", () => {
  assert.equal(parseDraft(null).ok, false);
  assert.equal(parseDraft({ text: "  " }).ok, false);
  assert.equal(parseDraft({ text: "a".repeat(MAX_TWEET_CHARS + 1) }).ok, false);
  assert.equal(parseDraft({ text: "a".repeat(MAX_TWEET_CHARS) }).ok, true);
});

test("URLs count as 23 characters and emoji as 2", () => {
  assert.equal(countTweetChars("see https://example.com/a/very/long/path?with=query"), 4 + 23);
  assert.equal(countTweetChars("hi 🚀"), 3 + 2);
  assert.ok(isWithinLimit(`${"a".repeat(250)} https://example.com/${"x".repeat(100)}`));
});

test("parseDraftBatch handles fenced JSON, prose, bad items and garbage", () => {
  const good = { drafts: [{ text: "One", angle: "A", whyThisWorks: "w" }, { text: "" }, { text: "One" }, { text: "Two" }] };
  const fenced = parseDraftBatch("Here you go:\n```json\n" + JSON.stringify(good) + "\n```");
  assert.deepEqual(fenced.drafts.map((d) => d.text), ["One", "Two"]);
  assert.ok(fenced.errors.length >= 1);
  assert.equal(parseDraftBatch("sorry, I can't").drafts.length, 0);
  assert.equal(parseDraftBatch("[]").drafts.length, 0);
  assert.equal(parseDraftBatch('{"text":"solo"}').drafts.length, 1);
  assert.equal(parseDraftBatch(JSON.stringify({ drafts: Array.from({ length: 6 }, (_, i) => ({ text: `t${i}` })) })).drafts.length, 3);
});

test("intentUrl encodes text for X's compose page", () => {
  const url = intentUrl("Hello & welcome\nline #2?");
  assert.equal(url, "https://x.com/intent/post?text=Hello%20%26%20welcome%0Aline%20%232%3F");
});

test("prompt forbids invented metrics, caps length and only cites verified results", () => {
  const { system, prompt } = buildDraftPrompt({ name: "Marlo", description: "SEO fixes", wins: ["Fixed noindex on /pricing"], variants: 9 });
  assert.match(system, /Never invent metrics/);
  assert.match(system, /280 characters/);
  assert.match(system, /3 posts/);
  assert.match(prompt, /Verified results:\n- Fixed noindex on \/pricing/);
  assert.match(buildDraftPrompt({ name: "Marlo" }).prompt, /Verified results: none/);
});

test("free plan is limited, self-host is not", () => {
  assert.equal(dailyDraftBatchLimit("free"), 5);
  assert.equal(dailyDraftBatchLimit("selfhost"), -1);
});

test("sqlite store: legacy table upgrade, insert, edit, complete, list views, delete, batch count", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE x_drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)");
  ensureXDraftColumns(db);
  ensureXDraftColumns(db); // idempotent

  const [a, b] = insertXDrafts(db, "p1", [
    { text: "First", angle: "Problem", whyThisWorks: "w1" },
    { text: "Second", angle: "Insight", whyThisWorks: "w2" },
  ]);
  insertXDrafts(db, "p2", [{ text: "Other project", angle: "x", whyThisWorks: "" }]);
  assert.equal(listXDrafts(db, "p1", "current").length, 2);
  assert.equal(a.batchId, b.batchId);
  assert.equal(countXBatchesSince(db, "p1", "2000-01-01T00:00:00.000Z"), 1);

  const edited = updateXDraft(db, "p1", a.id, { text: "First, edited" })!;
  assert.equal(edited.edited, true);
  assert.equal(updateXDraft(db, "p1", b.id, { status: "completed" })!.completedAt !== null, true);
  assert.deepEqual(listXDrafts(db, "p1", "current").map((d) => d.id), [a.id]);
  assert.deepEqual(listXDrafts(db, "p1", "archived").map((d) => d.id), [b.id]);
  assert.equal(updateXDraft(db, "p1", b.id, { status: "draft" })!.completedAt, null);

  assert.equal(updateXDraft(db, "p2", a.id, { text: "hijack" }), null, "other project cannot touch it");
  assert.equal(deleteXDraft(db, "p2", a.id), false);
  assert.equal(deleteXDraft(db, "p1", a.id), true);
});
