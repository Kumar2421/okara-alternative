import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { buildReferralReportBody, parseReferralRows } from "../lib/domain/geo/aiReferral.ts";
import { remainingRuns, resolveGeminiDailyCap } from "../lib/domain/geo/dailyCap.ts";
import { createGeminiGroundedPort, createSimulatedPort, parseGeminiResponse, type AnswerPort } from "../lib/domain/geo/engines.ts";
import { listRuns, sqliteRunStore } from "../lib/domain/geo/geoStore.ts";
import { mergePrompts, queryToPrompt, suggestPrompts } from "../lib/domain/geo/promptSet.ts";
import { crawlerBlocked, evaluateReadiness } from "../lib/domain/geo/readiness.ts";
import { runGeoPrompts } from "../lib/domain/geo/runner.ts";
import { aggregateRuns, analyzeAnswer, compareTrend } from "../lib/domain/geo/visibility.ts";
import type { GeoRunRow } from "../lib/domain/geo/types.ts";

const subject = { brand: "Marlo", domain: "marlo.app", competitors: ["hubspot.com", "semrush.com"] };

const ok = (body: string) => ({ state: "ok" as const, body });

const GOOD_HTML = `<html><head><script type="application/ld+json">{"@type":"Organization"}</script></head>
<body><h1>Marlo</h1><h2>Features</h2><h2>How does it work?</h2></body></html>`;

test("readiness: all good scores 100", () => {
  const r = evaluateReadiness({ robots: ok("User-agent: *\nAllow: /\nSitemap: https://x/sitemap.xml"), llms: ok("# Marlo"), sitemapXml: { state: "missing" }, homepageHtml: GOOD_HTML });
  assert.equal(r.score, 100);
  assert.equal(r.method, "readiness");
});

test("readiness: blocked crawler and missing pieces lower the score", () => {
  const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /";
  const r = evaluateReadiness({ robots: ok(robots), llms: { state: "missing" }, sitemapXml: { state: "missing" }, homepageHtml: "<html><h1>a</h1></html>" });
  assert.equal(r.checks.find((c) => c.id === "crawler-gptbot")?.status, "fail");
  assert.equal(r.checks.find((c) => c.id === "crawler-claudebot")?.status, "pass");
  assert.equal(r.checks.find((c) => c.id === "llms-txt")?.status, "fail");
  assert.ok(r.score < 50);
});

test("readiness: named group beats wildcard, wildcard block applies to all", () => {
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /", "ClaudeBot"), true);
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /\nUser-agent: ClaudeBot\nAllow: /", "ClaudeBot"), false);
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /private", "GPTBot"), false);
});

test("readiness: unfetchable homepage is unknown, not a failure", () => {
  const r = evaluateReadiness({ robots: { state: "missing" }, llms: ok("x"), sitemapXml: ok("<urlset></urlset>"), homepageHtml: null });
  assert.equal(r.checks.find((c) => c.id === "schema")?.status, "unknown");
  assert.equal(r.score, 100);
});

test("prompt set: questions, branded skipped, deduped, capped", () => {
  assert.equal(queryToPrompt("crm for startups"), "What is the best tool for crm for startups?");
  assert.equal(queryToPrompt("how to track leads"), "How to track leads?");
  const out = suggestPrompts(
    [
      { query: "marlo pricing", impressions: 999 },
      { query: "crm for startups", impressions: 50 },
      { query: "CRM for startups!", impressions: 40 },
      { query: "seo", impressions: 500 },
      ...Array.from({ length: 20 }, (_, i) => ({ query: `tool number ${i}`, impressions: i })),
    ],
    ["marlo"],
    10,
  );
  assert.equal(out.length, 10);
  assert.equal(out.filter((p) => /crm for startups/i.test(p)).length, 1);
  assert.ok(!out.some((p) => /marlo/i.test(p)));
});

test("prompt set: merge keeps manual first and respects the cap", () => {
  const existing = [{ prompt: "My own question?", source: "manual" as const, active: true }];
  const merged = mergePrompts(existing, Array.from({ length: 15 }, (_, i) => `Question ${i}?`), 10);
  assert.equal(merged[0].prompt, "My own question?");
  assert.equal(merged.filter((p) => p.active).length, 10);
});

test("visibility: mention, citation and competitors", () => {
  const a = analyzeAnswer(
    { answer: "Try Marlo or HubSpot for this.", citedUrls: ["https://www.marlo.app/blog", "https://semrush.com/x"] },
    subject,
  );
  assert.deepEqual(a, { mentioned: true, cited: true, competitors: ["hubspot.com", "semrush.com"] });
  const b = analyzeAnswer({ answer: "Marlowe is nice", citedUrls: [] }, subject);
  assert.equal(b.mentioned, false);
  assert.equal(b.cited, false);
});

function run(method: "gemini-grounded" | "simulated", runAt: string, mentioned: boolean): GeoRunRow {
  return { prompt: "p", engine: "e", method, runAt, mentioned, cited: false, competitors: [], sources: [], answerExcerpt: "" };
}

test("visibility: rates never mix methods, trend compares days", () => {
  const runs = [
    run("gemini-grounded", "2026-10-01T00:00:00Z", true),
    run("gemini-grounded", "2026-10-01T00:00:01Z", false),
    run("simulated", "2026-10-01T00:00:02Z", true),
    run("gemini-grounded", "2026-10-08T00:00:00Z", true),
    run("gemini-grounded", "2026-10-08T00:00:01Z", true),
  ];
  assert.equal(aggregateRuns(runs, "gemini-grounded").runs, 4);
  assert.equal(aggregateRuns(runs, "simulated").mentionRate, 1);
  const t = compareTrend(runs, "gemini-grounded");
  assert.equal(t.trend, "up");
  assert.equal(t.latest, 1);
  assert.equal(t.previous, 0.5);
  assert.equal(compareTrend(runs, "simulated").trend, "new");
});

test("daily cap: hosted default 20, env override, self-host uncapped", () => {
  assert.equal(resolveGeminiDailyCap(true, undefined), 20);
  assert.equal(resolveGeminiDailyCap(true, "5"), 5);
  assert.equal(resolveGeminiDailyCap(false, "5"), null);
  assert.equal(remainingRuns(20, 15), 5);
  assert.equal(remainingRuns(20, 25), 0);
  assert.equal(remainingRuns(null, 999), null);
});

function fakePort(method: "gemini-grounded" | "simulated", counter: { n: number }): AnswerPort {
  return {
    method,
    engine: method === "simulated" ? "Simulated (search results + Groq answer)" : "Gemini with Google Search",
    async ask() {
      counter.n += 1;
      return { answer: "Marlo is good", citedUrls: ["https://marlo.app/"] };
    },
  };
}

function memoryStore() {
  const rows: GeoRunRow[] = [];
  const used = new Map<string, number>();
  let locked = false;
  return {
    rows,
    store: {
      async countRuns(prompt: string, method: string, date: string) {
        return rows.filter((r) => r.prompt === prompt && r.method === method && r.runAt.startsWith(date)).length;
      },
      async countMethodRunsToday(method: string, date: string) {
        return used.get(method + date) ?? 0;
      },
      async reserve(method: string, date: string, cap: number) {
        const n = used.get(method + date) ?? 0;
        if (n + 1 > cap) return false;
        used.set(method + date, n + 1);
        return true;
      },
      async tryLock() {
        if (locked) return false;
        locked = true;
        return true;
      },
      async unlock() {
        locked = false;
      },
      async saveRuns(more: GeoRunRow[]) {
        rows.push(...more);
      },
    },
  };
}

test("runner: three runs per prompt, tagged with the port's method and engine", async () => {
  const c = { n: 0 };
  const m = memoryStore();
  const summary = await runGeoPrompts({ prompts: ["q1", "q2"], ports: [fakePort("simulated", c)], subject, store: m.store, now: () => new Date("2026-10-07T10:00:00Z") });
  assert.equal(summary.ran, 6);
  assert.equal(c.n, 6);
  assert.ok(m.rows.every((r) => r.method === "simulated" && r.engine.startsWith("Simulated")));
  assert.ok(m.rows.every((r) => r.mentioned && r.cited));
});

test("runner: idempotent within a day, tops up partial prompts", async () => {
  const c = { n: 0 };
  const m = memoryStore();
  const now = () => new Date("2026-10-07T10:00:00Z");
  const args = { prompts: ["q1"], ports: [fakePort("gemini-grounded", c)], subject, store: m.store, now };
  await runGeoPrompts(args);
  const again = await runGeoPrompts(args);
  assert.equal(c.n, 3);
  assert.equal(again.ran, 0);
  assert.equal(again.skippedAlreadyDone, 1);
  // Next day runs again.
  await runGeoPrompts({ ...args, now: () => new Date("2026-10-08T10:00:00Z") });
  assert.equal(c.n, 6);
});

test("runner: daily cap stops Gemini runs but not simulated", async () => {
  const g = { n: 0 };
  const s = { n: 0 };
  const m = memoryStore();
  const summary = await runGeoPrompts({
    prompts: ["a", "b", "c", "d"],
    ports: [fakePort("gemini-grounded", g), fakePort("simulated", s)],
    subject,
    store: m.store,
    caps: { "gemini-grounded": 7 },
    now: () => new Date("2026-10-07T10:00:00Z"),
  });
  // cap 7 over 4 prompts: 1 run per prompt instead of 3, so every prompt still gets a reading
  assert.equal(g.n, 4);
  assert.equal(s.n, 12);
  assert.equal(summary.runsPerPrompt["gemini-grounded"], 1);
  assert.equal(summary.runsPerPrompt.simulated, 3);
});

test("runner: stops at the time budget", async () => {
  const c = { n: 0 };
  const m = memoryStore();
  let t = 0;
  const summary = await runGeoPrompts({
    prompts: ["a", "b", "c"],
    ports: [fakePort("simulated", c)],
    subject,
    store: m.store,
    budgetMs: 10,
    clock: () => (t += 6),
  });
  assert.ok(summary.skippedBudget > 0);
  assert.ok(c.n < 9);
});

test("runner: a failing call is reported and earlier successes are kept", async () => {
  const m = memoryStore();
  let calls = 0;
  const flaky: AnswerPort = {
    method: "simulated",
    engine: "Simulated (search results + Groq answer)",
    async ask() {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return { answer: "Marlo", citedUrls: [] };
    },
  };
  const summary = await runGeoPrompts({ prompts: ["a"], ports: [flaky], subject, store: m.store, now: () => new Date("2026-10-07T10:00:00Z") });
  assert.equal(summary.ran, 1);
  assert.equal(summary.failed[0].error, "boom");
  assert.equal(m.rows.length, 1);
});

test("gemini port: sends key in a header, grounding tool, parses citations", async () => {
  let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
  const port = createGeminiGroundedPort({
    apiKey: "SECRET",
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers, body: init.body };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Marlo helps." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://redirect/x", title: "marlo.app" } }, { web: { uri: "https://other.com/p", title: "Other page" } }] } }],
        }),
      };
    },
  });
  const res = await port.ask("best tool?");
  assert.equal(port.method, "gemini-grounded");
  assert.ok(!captured!.url.includes("SECRET"));
  assert.equal(captured!.headers["x-goog-api-key"], "SECRET");
  assert.ok(captured!.body.includes("google_search"));
  assert.deepEqual(res.citedUrls, ["https://marlo.app/", "https://other.com/p"]);
  assert.equal(parseGeminiResponse({}).answer, "");
});

test("gemini port: HTTP errors do not leak the key", async () => {
  const port = createGeminiGroundedPort({ apiKey: "SECRET", fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  await assert.rejects(port.ask("x"), (e: Error) => e.message.includes("429") && !e.message.includes("SECRET"));
});

test("simulated port is always labelled simulated and cites search hits", async () => {
  const port = createSimulatedPort({
    search: async () => [{ title: "T", url: "https://marlo.app/a", content: "c" }],
    complete: async () => "Marlo is an option",
  });
  assert.equal(port.method, "simulated");
  assert.ok(!/chatgpt|perplexity|claude|gemini/i.test(port.engine));
  assert.deepEqual((await port.ask("q")).citedUrls, ["https://marlo.app/a"]);
});

test("sqlite store: round trip, per-day counts", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE geo_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, prompt TEXT NOT NULL, engine TEXT NOT NULL, method TEXT NOT NULL, run_at TEXT NOT NULL, mentioned INTEGER NOT NULL DEFAULT 0, cited INTEGER NOT NULL DEFAULT 0, competitors TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]', answer_excerpt TEXT NOT NULL DEFAULT ''); CREATE TABLE geo_usage (method TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (method, day));`);
  const store = sqliteRunStore(db, "p1");
  await store.saveRuns([{ ...run("simulated", "2026-10-07T10:00:00.000Z", true), prompt: "q", competitors: ["x"] }]);
  assert.equal(await store.countRuns("q", "simulated", "2026-10-07"), 1);
  assert.equal(await store.countRuns("q", "gemini-grounded", "2026-10-07"), 0);
  assert.equal(await store.countMethodRunsToday("simulated", "2026-10-08"), 0);
  const rows = listRuns(db, "p1", "2026-01-01");
  assert.equal(rows[0].mentioned, true);
  assert.deepEqual(rows[0].competitors, ["x"]);
  assert.equal(listRuns(db, "other", "2026-01-01").length, 0);
});

test("AI referral: sums aliases, ignores unrelated sources", () => {
  const body = buildReferralReportBody("2026-09-01", "2026-09-28");
  assert.ok(JSON.stringify(body).includes("chatgpt.com"));
  const r = parseReferralRows([
    { dimensionValues: [{ value: "chatgpt.com" }], metricValues: [{ value: "5" }] },
    { dimensionValues: [{ value: "perplexity" }], metricValues: [{ value: "2" }] },
    { dimensionValues: [{ value: "perplexity.ai" }], metricValues: [{ value: "1" }] },
    { dimensionValues: [{ value: "google" }], metricValues: [{ value: "100" }] },
  ]);
  assert.equal(r.total, 8);
  assert.equal(r.method, "referral");
  assert.deepEqual(r.bySource[1], { source: "perplexity.ai", sessions: 3 });
  assert.equal(parseReferralRows(undefined).total, 0);
});
