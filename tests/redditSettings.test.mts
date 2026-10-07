import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  addKeyword, addSubreddit, buildRedditSearchPlan, emptyRedditSettings, mergeSubreddits, normalizeRedditSettings,
  normalizeSubreddit, REDDIT_LIMITS,
} from "../lib/domain/reddit/redditSettings.ts";
import { getRedditSettings, saveRedditSettings } from "../lib/domain/reddit/redditSettingsStore.ts";

test("normalizeSubreddit accepts common spellings and rejects invalid names", () => {
  const cases: [unknown, string | null][] = [
    ["r/Startups", "r/Startups"], ["/r/startups/", "r/startups"], ["startups", "r/startups"],
    ["https://www.reddit.com/r/SaaS/top", "r/SaaS"], ["  r/a_b9  ", "r/a_b9"],
    ["r/a", null], ["r/has space", null], ["r/toolongtoolongtoolongx", null], ["", null], [5, null], [null, null],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeSubreddit(input), expected, String(input));
});

test("normalizeRedditSettings dedupes, caps lists and falls back to global", () => {
  const subs = Array.from({ length: 30 }, (_, i) => `sub${i}x`);
  const kws = Array.from({ length: 40 }, (_, i) => `kw ${i}`);
  const s = normalizeRedditSettings({ subreddits: ["r/Foo", "foo", "bad name", ...subs], keywords: [" SEO ", "seo", ...kws], country: "fr" });
  assert.equal(s.subreddits[0], "r/Foo");
  assert.equal(s.subreddits.length, REDDIT_LIMITS.subreddits);
  assert.equal(s.keywords[0], "SEO");
  assert.equal(s.keywords.length, REDDIT_LIMITS.keywords);
  assert.equal(s.country, "global");
  assert.equal(normalizeRedditSettings({ country: "us" }).country, "us");
  assert.deepEqual(normalizeRedditSettings(null), emptyRedditSettings());
  assert.deepEqual(normalizeRedditSettings({ subreddits: "r/foo" }).subreddits, []);
});

test("addSubreddit / addKeyword validate, dedupe and enforce limits", () => {
  assert.deepEqual(addSubreddit([], "startups"), { ok: true, list: ["r/startups"] });
  assert.equal(addSubreddit(["r/startups"], "R/Startups").ok, false);
  assert.equal(addSubreddit([], "no way!").ok, false);
  const full = Array.from({ length: 20 }, (_, i) => `r/sub${i}x`);
  const r = addSubreddit(full, "another");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /20/);
  assert.equal(addKeyword([], "   ").ok, false);
  assert.deepEqual(addKeyword(["seo"], " link  building "), { ok: true, list: ["seo", "link building"] });
  assert.equal(addKeyword(Array.from({ length: 30 }, (_, i) => `k${i}`), "more").ok, false);
});

test("buildRedditSearchPlan: empty settings keep current behaviour", () => {
  assert.deepEqual(buildRedditSearchPlan(emptyRedditSettings()), { queries: [], country: null });
});

test("buildRedditSearchPlan builds site queries per subreddit with keyword terms", () => {
  const plan = buildRedditSearchPlan({ ...emptyRedditSettings(), subreddits: ["r/SaaS", "r/seo"], keywords: ["seo", "link building", "audit", "extra"], country: "us" });
  assert.deepEqual(plan.queries, [
    'site:reddit.com/r/SaaS seo OR "link building" OR audit',
    'site:reddit.com/r/seo seo OR "link building" OR audit',
  ]);
  assert.equal(plan.country, "us");
});

test("buildRedditSearchPlan uses keyword-only queries and caps the count", () => {
  const plan = buildRedditSearchPlan({ ...emptyRedditSettings(), keywords: ["a1", "b2", "c3", "d4"] });
  assert.deepEqual(plan.queries, ["site:reddit.com a1 OR b2 OR c3", "site:reddit.com d4"]);
  const many = buildRedditSearchPlan({ ...emptyRedditSettings(), subreddits: Array.from({ length: 20 }, (_, i) => `r/sub${i}x`) });
  assert.equal(many.queries.length, 12);
  assert.deepEqual(buildRedditSearchPlan({ ...emptyRedditSettings(), country: "us" }), { queries: [], country: "us" });
});

test("mergeSubreddits puts requested first, adds saved, dedupes case-insensitively", () => {
  assert.deepEqual(mergeSubreddits(["reactjs", "SaaS"], ["r/saas", "r/seo"]), ["reactjs", "SaaS", "seo"]);
  assert.deepEqual(mergeSubreddits([], []), []);
  assert.deepEqual(mergeSubreddits(["bad name"], []), []);
});

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE project_documents (project_id TEXT NOT NULL, doc_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, doc_type));`);
  return db;
}

test("store: empty by default, round-trips, overwrites, and is scoped per project", () => {
  const db = memoryDb();
  assert.deepEqual(getRedditSettings(db, "p1"), emptyRedditSettings());
  const a = normalizeRedditSettings({ subreddits: ["r/seo"], keywords: ["audit"], country: "us" });
  saveRedditSettings(db, "p1", a);
  assert.deepEqual(getRedditSettings(db, "p1"), a);
  saveRedditSettings(db, "p1", normalizeRedditSettings({ keywords: ["x1"] }));
  assert.deepEqual(getRedditSettings(db, "p1").subreddits, []);
  assert.deepEqual(getRedditSettings(db, "p2"), emptyRedditSettings());
});

test("store: corrupt content reads as empty settings", () => {
  const db = memoryDb();
  db.prepare("INSERT INTO project_documents VALUES ('p1','reddit_settings','ready','{not json','t','t')").run();
  assert.deepEqual(getRedditSettings(db, "p1"), emptyRedditSettings());
});
