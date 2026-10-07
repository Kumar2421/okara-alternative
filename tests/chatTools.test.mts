import { test } from "node:test";
import * as assert from "node:assert";
import { runTool, CHAT_TOOLS, MAX_RESULT_CHARS, sanitize, type ChatPorts, type LeadSummary } from "../lib/domain/chat/tools.ts";
import { summarizeLeads, geoFromRow, supabaseLeadSummary } from "../lib/domain/chat/chatQueries.ts";
import {
  runChatTurn, buildToolDefs, buildAutoSummary, MAX_TOOL_CALLS, MAX_TOTAL_RESULT_CHARS, isToolUnsupportedError, type DriverLike,
} from "../lib/domain/chat/toolLoop.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";
import type { SearchSnapshotPayload, SnapshotQuery } from "../lib/domain/search/searchSnapshot.ts";

const q = (query: string, clicks: number, impressions: number, position: number): SnapshotQuery => ({
  query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
});
const win = (queries: SnapshotQuery[]) => ({ startDate: "2026-09-01", endDate: "2026-09-28", queries });
const payload: SearchSnapshotPayload = {
  version: 1, capturedAt: "2026-10-01T00:00:00Z", siteUrl: "https://x.com",
  windows: {
    d7: win([q("a", 1, 10, 3)]),
    d28: { ...win([q("alpha", 10, 1000, 5), q("beta", 5, 500, 2)]), queries: [q("alpha", 10, 1000, 5), q("beta", 5, 500, 2)].map((r) => ({ ...r, rankingPages: [] })) },
    d90: win([]),
    prev28: win([q("alpha", 20, 900, 4)]),
  },
};

const finding = (id: string, status: Finding["status"] = "new", evidence: Record<string, unknown> = {}): Finding => ({
  id, projectId: "p1", source: "seo", category: "missing_canonical", entityType: "page", entityId: "e", url: "https://x.com/a",
  severity: "warning", evidence, recommendation: "Add a canonical tag", status, firstSeen: "2026-09-01", lastSeen: "2026-09-20", resolvedAt: null,
});

function fakePorts(over: Partial<ChatPorts> = {}): ChatPorts {
  const leads: LeadSummary = { total: 0, withEmail: 0, emailVerified: 0, emailed: 0, replied: 0, recent: [] };
  return {
    getSearchSnapshot: async () => ({ snapshotDate: "2026-10-01", payload }),
    listFindings: async () => [finding("f1"), finding("f2", "fixed")],
    getFinding: async (id) => (id === "f1" ? finding("f1", "new", { page: { url: "u" }, apiToken: "SECRET", contactEmail: "a@b.com" }) : null),
    recommendationsFor: () => [{ title: "Add canonical", summary: "do it", priority: "high" }],
    listActionsWithOutcomes: async () => [],
    getLeadSummary: async () => leads,
    getGeoStatus: async () => null,
    now: () => new Date("2026-10-07T00:00:00Z"),
    ...over,
  };
}

test("every tool in the registry is runnable and read-only named", async () => {
  for (const t of CHAT_TOOLS) {
    const r = await runTool(fakePorts(), t.name, t.name === "get_finding" ? { id: "f1" } : {});
    assert.ok(r.content.length > 0, t.name);
  }
  assert.equal((await runTool(fakePorts(), "drop_table")).ok, false);
});

test("search summary: totals, top queries, data date", async () => {
  const r = await runTool(fakePorts(), "get_search_summary");
  const d = JSON.parse(r.content);
  assert.equal(d.dataDate, "2026-10-01");
  assert.equal(d.totals.clicks, 15);
  assert.equal(d.totals.views, 1500);
  assert.equal(d.topQueries[0].query, "alpha");
  assert.equal(d.previous28Days.clicks, 20);
});

test("search tools: empty state says not available instead of inventing", async () => {
  const p = fakePorts({ getSearchSnapshot: async () => null });
  assert.equal(JSON.parse((await runTool(p, "get_search_summary")).content).available, false);
  assert.equal(JSON.parse((await runTool(p, "list_opportunities")).content).available, false);
});

test("list_opportunities returns capped rows", async () => {
  const d = JSON.parse((await runTool(fakePorts(), "list_opportunities")).content);
  assert.ok(d.opportunities.length <= 10);
  assert.equal(d.dataDate, "2026-10-01");
});

test("list_findings: status filter, counts, bad status rejected", async () => {
  const all = JSON.parse((await runTool(fakePorts(), "list_findings")).content);
  assert.equal(all.totalFindings, 2);
  assert.deepEqual(all.byStatus, { new: 1, fixed: 1 });
  const fixed = JSON.parse((await runTool(fakePorts(), "list_findings", { status: "fixed" })).content);
  assert.equal(fixed.findings.length, 1);
  assert.equal((await runTool(fakePorts(), "list_findings", { status: "bogus" })).ok, false);
});

test("list_findings caps rows", async () => {
  const many = Array.from({ length: 50 }, (_, i) => finding(`f${i}`));
  const d = JSON.parse((await runTool(fakePorts({ listFindings: async () => many }), "list_findings")).content);
  assert.equal(d.findings.length, 10);
  assert.equal(d.totalFindings, 50);
});

test("get_finding: scoped lookup, recommendations, secrets stripped", async () => {
  const r = await runTool(fakePorts(), "get_finding", { id: "f1" });
  assert.ok(!r.content.includes("SECRET"));
  assert.ok(!r.content.includes("a@b.com"));
  const d = JSON.parse(r.content);
  assert.equal(d.recommendations[0].title, "Add canonical");
  const miss = await runTool(fakePorts(), "get_finding", { id: "other-project-finding" });
  assert.equal(miss.ok, false);
  assert.equal((await runTool(fakePorts(), "get_finding", {})).ok, false);
});

test("get_finding passes the finding id to the actions port", async () => {
  let seen: string | undefined;
  await runTool(fakePorts({ listActionsWithOutcomes: async (id) => { seen = id; return []; } }), "get_finding", { id: "f1" });
  assert.equal(seen, "f1");
});

test("actions and outcomes: empty, then verdict counts", async () => {
  assert.equal(JSON.parse((await runTool(fakePorts(), "list_actions_and_outcomes")).content).available, false);
  const action = {
    id: "a1", projectId: "p1", findingId: "f1", type: "rewrite_snippet", status: "completed", title: "Rewrite title", target: {}, parameters: {},
    result: { implementation: { secretish: "x" } }, createdAt: "2026-09-01", startedAt: null, completedAt: "2026-09-02",
    outcome: { status: "improved", daysSince: 20, daysUntilReady: 0, confidence: "solid", headline: "Clicks up", pageNote: null, baseline: null, current: null, via: "manual" },
  } as never;
  const d = JSON.parse((await runTool(fakePorts({ listActionsWithOutcomes: async () => [action] }), "list_actions_and_outcomes")).content);
  assert.deepEqual(d.counts, { improved: 1 });
  assert.equal(d.actions[0].outcome.headline, "Clicks up");
  assert.ok(!JSON.stringify(d).includes("secretish"), "raw action result is not exposed");
});

test("leads: counts and recent, no raw emails", async () => {
  const rows = [
    { name: "Ann", title: "CTO", company: "Acme", location: "NYC", lead_type: "person", email: "ann@acme.com", email_verified: 1, emailed_at: "2026-09-02", last_reply_at: null, created_at: "2026-09-01" },
    { name: "Bob", title: "", company: "B", location: "", lead_type: "person", email: null, email_verified: 0, emailed_at: null, last_reply_at: "2026-09-05", created_at: "2026-09-03" },
  ];
  const s = summarizeLeads(rows, 1);
  assert.equal(s.total, 2);
  assert.equal(s.withEmail, 1);
  assert.equal(s.recent.length, 1);
  assert.equal(s.recent[0].name, "Bob");
  const r = await runTool(fakePorts({ getLeadSummary: async () => s }), "list_leads");
  assert.ok(!r.content.includes("ann@acme.com"));
  assert.equal(JSON.parse((await runTool(fakePorts(), "list_leads")).content).available, false);
});

test("supabase lead query is scoped by user and project", async () => {
  const eqs: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => { eqs.push([c, v]); return chain; };
  chain.order = () => chain;
  chain.limit = async () => ({ data: [] });
  const db = { from: () => chain } as never;
  await supabaseLeadSummary(db, "u1", "p1", 5);
  assert.deepEqual(eqs, [["user_id", "u1"], ["project_id", "p1"]]);
});

test("geo: parse string or parsed payloads; empty and bad data", async () => {
  assert.equal(geoFromRow(null), null);
  assert.equal(geoFromRow({ payload: "not json", checked_at: "x" }), null);
  const g = geoFromRow({ payload: JSON.stringify([{ query: "best crm", found: true, matchedUrl: "https://x.com" }, { query: "crm tips", found: false }]), checked_at: "2026-10-01" });
  const d = JSON.parse((await runTool(fakePorts({ getGeoStatus: async () => g }), "get_geo_status")).content);
  assert.equal(d.cited, 1);
  assert.equal(d.notCited, 1);
  assert.equal(JSON.parse((await runTool(fakePorts(), "get_geo_status")).content).available, false);
});

test("results are capped in size", async () => {
  const big = finding("f1", "new", { page: "x".repeat(100000), list: Array.from({ length: 100 }, () => "y".repeat(190)) });
  const r = await runTool(fakePorts({ getFinding: async () => big }), "get_finding", { id: "f1" });
  assert.ok(r.content.length <= MAX_RESULT_CHARS);
});

test("a throwing port yields a tool error, not an exception", async () => {
  const r = await runTool(fakePorts({ listFindings: async () => { throw new Error("db down"); } }), "list_findings");
  assert.equal(r.ok, false);
});

test("sanitize drops secret-looking keys", () => {
  const out = sanitize({ ok: 1, access_token: "t", nested: { apiKey: "k", fine: "v" }, owner_email: "a@b.c" }) as Record<string, unknown>;
  assert.deepEqual(out, { ok: 1, nested: { fine: "v" } });
});

// ---- loop ----

test("tool defs enforce call count and total char budget, and record usage", async () => {
  const used: string[] = [];
  const defs = buildToolDefs(fakePorts(), used);
  const search = defs.find((d) => d.name === "get_search_summary")!;
  let budgetHit = false;
  for (let i = 0; i < MAX_TOOL_CALLS + 3; i++) {
    const out = await search.execute({});
    if (out.startsWith("Tool budget used up")) budgetHit = true;
  }
  assert.ok(budgetHit);
  assert.deepEqual(used, ["get_search_summary"]);

  const big = finding("f1", "new", { list: Array.from({ length: 5 }, () => "z".repeat(190)) });
  const lots = Array.from({ length: 40 }, (_, i) => ({ ...big, id: `x${i}` }));
  const defs2 = buildToolDefs(fakePorts({ listFindings: async () => lots }), []);
  const list = defs2.find((d) => d.name === "list_findings")!;
  let total = 0;
  for (let i = 0; i < MAX_TOOL_CALLS; i++) total += (await list.execute({})).length;
  assert.ok(total <= MAX_TOTAL_RESULT_CHARS + 200);
});

test("tool-capable provider: tools passed, names and labels returned", async () => {
  let seenTools = 0;
  let seenSystem = "";
  const driver: DriverLike = async (req) => {
    seenTools = req.tools?.length ?? 0;
    seenSystem = req.system ?? "";
    await req.tools!.find((t) => t.name === "list_findings")!.execute({});
    await req.tools!.find((t) => t.name === "get_search_summary")!.execute({});
    return { text: "done" };
  };
  const r = await runChatTurn({ driver, apiKey: "k", model: "m", system: "STYLE", messages: [{ role: "user", content: "hi" }], ports: fakePorts(), supportsTools: true });
  assert.equal(r.mode, "tools");
  assert.equal(seenTools, CHAT_TOOLS.length);
  assert.match(seenSystem, /Never invent/);
  assert.deepEqual(r.toolsUsed, ["list_findings", "get_search_summary"]);
  assert.deepEqual(r.lookedAt, ["findings", "search data"]);
});

test("provider without tools: context fallback with auto summary, no tools passed", async () => {
  let req: Parameters<DriverLike>[0] | undefined;
  const driver: DriverLike = async (r) => { req = r; return { text: "ok" }; };
  const r = await runChatTurn({ driver, apiKey: "k", model: "m", system: "STYLE", messages: [{ role: "user", content: "hi" }], ports: fakePorts(), supportsTools: false });
  assert.equal(r.mode, "context");
  assert.equal(req!.tools, undefined);
  assert.match(req!.system!, /Findings: 2 total/);
  assert.match(req!.system!, /Leads: 0 total/);
  assert.match(req!.system!, /1500 views/);
  assert.deepEqual(r.lookedAt, []);
});

test("auto summary survives failing ports and missing data", async () => {
  const s = await buildAutoSummary(fakePorts({ getSearchSnapshot: async () => null, listFindings: async () => { throw new Error("x"); } }));
  assert.match(s, /no Search Console data/);
  assert.doesNotMatch(s, /Findings:/);
});

test("model that rejects tool calling falls back to context; other errors propagate", async () => {
  let calls = 0;
  const driver: DriverLike = async (req) => {
    calls++;
    if (req.tools) throw new Error("400 this model does not support tools");
    return { text: "plain" };
  };
  const r = await runChatTurn({ driver, apiKey: "k", model: "m", system: "S", messages: [], ports: fakePorts(), supportsTools: true });
  assert.equal(r.mode, "context");
  assert.equal(calls, 2);
  const bad: DriverLike = async () => { throw new Error("401 invalid api key"); };
  await assert.rejects(runChatTurn({ driver: bad, apiKey: "k", model: "m", system: "S", messages: [], ports: fakePorts(), supportsTools: true }));
  assert.equal(isToolUnsupportedError(new Error("rate limit 429")), false);
});

test("secrets in stored data never reach the model via the summary or tools", async () => {
  const leak = fakePorts({ getFinding: async () => finding("f1", "new", { refresh_token: "RT-123", note: "ok" }) });
  const r = await runTool(leak, "get_finding", { id: "f1" });
  assert.ok(!r.content.includes("RT-123"));
  assert.ok(r.content.includes("ok"));
});
