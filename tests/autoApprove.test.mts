import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_PROPOSAL_CAP, isLowRisk, planDailyProposals } from "../lib/domain/actions/autoApprove.ts";
import { runDailyProposals, type DailyProposalPorts } from "../lib/domain/actions/dailyProposals.ts";
import { ACTION_TYPES, type Action } from "../lib/domain/actions/actionTypes.ts";
import { normalizeAutomation } from "../lib/domain/actions/automationSettings.ts";
import { findingForOpportunity } from "../lib/domain/search/opportunityFinding.ts";
import type { Finding } from "../lib/domain/findings/findingTypes.ts";
import type { OpportunityType, SearchOpportunity } from "../lib/domain/search/searchOpportunities.ts";
import type { SearchSnapshotPayload } from "../lib/domain/search/searchSnapshot.ts";

const NOW = new Date("2026-10-10T08:00:00.000Z");
const BASE = { projectId: "p1", brand: "Marlo", capturedAt: "2026-10-10T00:00:00.000Z", now: NOW };

function opp(type: OpportunityType, query: string, score = 50): SearchOpportunity {
  return {
    type, query, pageUrl: "https://example.com/seo", score, reasons: ["r"], previous: null,
    metrics: { clicks: 10, impressions: 1200, ctr: 0.01, position: 2.1 },
  };
}

function findingFor(o: SearchOpportunity, id: string, status: Finding["status"] = "new"): Finding {
  const f = findingForOpportunity(o, BASE);
  return { ...f, id, status, severity: f.severity, url: f.url, firstSeen: "x", lastSeen: "x", resolvedAt: null } as Finding;
}

function action(over: Partial<Action> = {}): Action {
  return {
    id: "a1", projectId: "p1", findingId: "f1", type: "rewrite_snippet", status: "proposed", title: "t",
    target: {}, parameters: { autoProposed: true }, result: null, createdAt: "2026-10-10T01:00:00.000Z", startedAt: null, completedAt: null, ...over,
  };
}

const plan = (over: Partial<Parameters<typeof planDailyProposals>[0]> = {}) =>
  planDailyProposals({ opportunities: [], existingFindings: [], existingActions: [], mode: "auto_approve_safe", ...BASE, ...over });

test("isLowRisk allows only suggestion-style types; PR/code/email types never", () => {
  const allowed = ACTION_TYPES.filter((type) => isLowRisk({ type }));
  assert.deepEqual([...allowed].sort(), ["improve_content_relevance", "investigate_ranking_change", "rewrite_snippet"]);
  for (const type of ["add_canonical", "remove_noindex", "investigate_ttfb", "manual_fix"] as const) assert.equal(isLowRisk({ type }), false, type);
});

test("isLowRisk is false when the action targets a repo or carries PR/email parameters", () => {
  assert.equal(isLowRisk({ type: "rewrite_snippet", target: { repository: "o/r" } }), false);
  assert.equal(isLowRisk({ type: "rewrite_snippet", target: { file: "a.html" } }), false);
  assert.equal(isLowRisk({ type: "rewrite_snippet", parameters: { openPr: true } }), false);
  assert.equal(isLowRisk({ type: "rewrite_snippet", parameters: { sendEmail: true } }), false);
  assert.equal(isLowRisk({ type: "rewrite_snippet", target: { url: "https://example.com" }, parameters: { autoProposed: true } }), true);
});

test("ask-me mode proposes but approves nothing", () => {
  const result = plan({ mode: "off", opportunities: [opp("ctr", "a"), opp("ranking", "b")] });
  assert.ok(result.proposals.length > 0);
  assert.ok(result.proposals.every((p) => p.approve === false));
});

test("auto mode proposes ctr (rewrite_snippet) and approves it as low risk", () => {
  const [p] = plan({ opportunities: [opp("ctr", "a")] }).proposals;
  assert.equal(p.actionType, "rewrite_snippet");
  assert.equal(p.approve, true);
  assert.equal(p.existingFindingId, null);
});

test("cap: at most 3 per day, highest score first", () => {
  const opportunities = ["a", "b", "c", "d", "e"].map((q, i) => opp("ctr", q, i));
  const result = plan({ opportunities });
  assert.equal(DAILY_PROPOSAL_CAP, 3);
  assert.deepEqual(result.proposals.map((p) => p.opportunity.query), ["e", "d", "c"]);
});

test("cap counts actions already auto-proposed today, not yesterday's or manual ones", () => {
  const opportunities = ["a", "b", "c"].map((q, i) => opp("ctr", q, i));
  const existingActions = [
    action({ id: "1" }),
    action({ id: "2", createdAt: "2026-10-09T23:00:00.000Z" }),
    action({ id: "3", parameters: {} }),
  ];
  assert.equal(plan({ opportunities, existingActions }).proposals.length, 2);
  const full = [action({ id: "1" }), action({ id: "2" }), action({ id: "3" })];
  assert.equal(plan({ opportunities, existingActions: full }).proposals.length, 0);
});

test("skips tracked findings that are fixed, verified, failed, acknowledged or already have an action", () => {
  for (const status of ["fixed", "verified", "failed", "fixing", "acknowledged"] as const) {
    const o = opp("ctr", "x");
    assert.equal(plan({ opportunities: [o], existingFindings: [findingFor(o, "f1", status)] }).proposals.length, 0, status);
  }
  const o = opp("ctr", "x");
  const withAction = plan({ opportunities: [o], existingFindings: [findingFor(o, "f1")], existingActions: [action({ findingId: "f1", createdAt: "2026-10-01T00:00:00.000Z", parameters: {} })] });
  assert.equal(withAction.proposals.length, 0);
});

test("a new finding with no action is reused, not duplicated; a cancelled action does not block", () => {
  const o = opp("ctr", "x");
  const result = plan({ opportunities: [o], existingFindings: [findingFor(o, "f1")], existingActions: [action({ findingId: "f1", status: "cancelled", createdAt: "2026-10-01T00:00:00.000Z", parameters: {} })] });
  assert.equal(result.proposals[0].existingFindingId, "f1");
});

test("duplicate opportunities (same identity) plan once", () => {
  assert.equal(plan({ opportunities: [opp("ctr", "Same Query"), opp("ctr", "same  query")] }).proposals.length, 1);
});

test("normalizeAutomation: only the exact opt-in value turns it on", () => {
  assert.equal(normalizeAutomation(null).mode, "off");
  assert.equal(normalizeAutomation({ mode: "on" }).mode, "off");
  assert.equal(normalizeAutomation({ mode: "auto_approve_safe" }).mode, "auto_approve_safe");
});

// ───────── job with fake ports ─────────

const q = (query: string, impressions: number, position: number, clicks = 1) => ({
  query, clicks, impressions, ctr: clicks / impressions, position,
});

function snapshot(): SearchSnapshotPayload {
  const window = (queries: ReturnType<typeof q>[]) => ({ startDate: "2026-09-01", endDate: "2026-09-28", queries });
  const main = [q("alpha tool", 2000, 2.0, 5), q("beta tool", 1500, 2.5, 4), q("gamma tool", 1000, 3.0, 3), q("delta tool", 900, 1.5, 2)]
    .map((row) => ({ ...row, rankingPages: [{ url: "https://example.com/p", clicks: 1, impressions: 10, position: 2 }] }));
  return {
    version: 1, capturedAt: "2026-10-10T00:00:00.000Z", siteUrl: "https://example.com/",
    windows: { d7: window([]), d28: { ...window([]), queries: main } as SearchSnapshotPayload["windows"]["d28"], d90: window([]), prev28: window([]) },
  } as unknown as SearchSnapshotPayload;
}

function fakePorts(mode: "off" | "auto_approve_safe") {
  const findings: Finding[] = [];
  const actions: Action[] = [];
  const approved: string[] = [];
  const claims = new Set<string>();
  const ports: DailyProposalPorts = {
    getMode: async () => mode,
    getSnapshot: async () => ({ payload: snapshot() }),
    listFindings: async () => [...findings],
    listActions: async () => [...actions],
    saveFinding: async (input) => {
      const f = { ...input, url: input.url ?? null, id: `f${findings.length + 1}`, status: "new", firstSeen: "x", lastSeen: "x", resolvedAt: null } as Finding;
      findings.push(f);
      return f;
    },
    createAction: async (input) => {
      const a = { ...input, id: `a${actions.length + 1}`, status: "proposed", result: null, createdAt: NOW.toISOString(), startedAt: null, completedAt: null } as Action;
      actions.push(a);
      return a;
    },
    approveAction: async (id) => {
      approved.push(id);
      const a = actions.find((x) => x.id === id)!;
      a.status = "approved";
    },
    markAutoApproved: async (id) => {
      const a = actions.find((x) => x.id === id)!;
      a.parameters = { ...a.parameters, autoApproved: true };
    },
    claimDay: async (day) => {
      if (claims.has(day)) return false;
      claims.add(day);
      return true;
    },
    releaseDay: async (day) => {
      claims.delete(day);
    },
  };
  return { ports, findings, actions, approved, claims };
}

const PROJECT = { id: "p1", name: "Marlo", url: "https://example.com" };

test("job: ask-me mode proposes up to 3 but approves none", async () => {
  const f = fakePorts("off");
  const summary = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.ok(summary.proposed > 0 && summary.proposed <= 3);
  assert.equal(summary.approved, 0);
  assert.ok(f.actions.every((a) => a.status !== "approved"));
});

test("job: auto mode proposes at most 3, approves only low-risk, and a rerun the same day adds nothing", async () => {
  const f = fakePorts("auto_approve_safe");
  const first = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.ok(first.proposed > 0 && first.proposed <= 3);
  assert.equal(f.findings.length, first.findingsCreated);
  assert.ok(f.actions.every((a) => a.parameters.autoProposed === true));
  for (const a of f.actions) assert.equal(a.status === "approved", a.parameters.autoApproved === true);
  assert.equal(first.approved, f.approved.length);
  assert.deepEqual(first.errors, []);

  const second = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.equal(second.proposed, 0);
  assert.equal(f.actions.length, first.proposed);
});

test("job: a failing item is reported without secrets and does not stop the rest", async () => {
  const f = fakePorts("auto_approve_safe");
  let calls = 0;
  const original = f.ports.createAction;
  f.ports.createAction = async (input) => {
    calls += 1;
    if (calls === 1) throw new Error("db down");
    return original(input);
  };
  const summary = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.deepEqual(summary.errors, ["db down"]);
  assert.ok(summary.proposed >= 1);
});

test("job: a held day-claim means no actions are created (overlapping run)", async () => {
  const f = fakePorts("auto_approve_safe");
  f.claims.add("2026-10-10");
  const summary = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.equal(summary.proposed, 0);
  assert.equal(f.actions.length, 0);
});

test("job: two overlapping runs create at most 3 actions and no duplicate per finding", async () => {
  const f = fakePorts("auto_approve_safe");
  const [a, b] = await Promise.all([runDailyProposals(f.ports, PROJECT, NOW), runDailyProposals(f.ports, PROJECT, NOW)]);
  assert.equal(a.proposed + b.proposed, f.actions.length);
  assert.ok(f.actions.length <= DAILY_PROPOSAL_CAP);
  assert.equal(new Set(f.actions.map((x) => x.findingId)).size, f.actions.length);
  assert.equal(f.claims.size, 0, "claim released");
});

test("job: cap is re-checked right before creating even if the claim was bypassed", async () => {
  const f = fakePorts("auto_approve_safe");
  const original = f.ports.listActions;
  let listed = 0;
  f.ports.listActions = async () => {
    listed += 1;
    // After the planning read, a concurrent run fills today's cap.
    if (listed === 2) for (let i = 0; i < DAILY_PROPOSAL_CAP; i += 1) f.actions.push(action({ id: "x" + i, findingId: "other" + i, createdAt: NOW.toISOString() }));
    return original();
  };
  const summary = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.equal(summary.proposed, 0);
});

test("job: autoApproved marker is set only after approval succeeds", async () => {
  const f = fakePorts("auto_approve_safe");
  f.ports.approveAction = async () => { throw new Error("approve failed"); };
  const summary = await runDailyProposals(f.ports, PROJECT, NOW);
  assert.ok(summary.errors.length > 0);
  assert.ok(f.actions.length > 0);
  for (const a of f.actions) {
    assert.equal(a.status, "proposed");
    assert.equal(a.parameters.autoApproved, undefined);
  }
});

test("isLowRisk guards the real parameters: the params the job passes are allowed, a risky one is not", () => {
  assert.equal(isLowRisk({ type: "rewrite_snippet", target: { url: "https://example.com/p" }, parameters: { autoProposed: true } }), true);
  assert.equal(isLowRisk({ type: "rewrite_snippet", target: { url: "https://example.com/p" }, parameters: { autoProposed: true, pullRequest: 1 } }), false);
});
