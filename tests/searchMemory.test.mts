import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildSnapshotPayload, retentionCutoff, snapshotRanges, SNAPSHOT_RETENTION_DAYS } from "../lib/domain/search/searchSnapshot.ts";
import { captureSearchSnapshot } from "../lib/domain/search/searchConsoleClient.ts";
import { selectDueProjects } from "../lib/domain/search/dueProjects.ts";
import { countSnapshots, getLatestSnapshot, saveSnapshot } from "../lib/domain/search/searchSnapshotStore.ts";
import { isAuthorizedCron, runWithBudget } from "../lib/jobs/jobRunner.ts";
import type { QueryRow } from "../lib/domain/search/types.ts";

const NOW = new Date("2026-10-10T12:00:00Z");

function row(keys: string[], impressions: number, clicks = 0, position = 8): QueryRow {
  return { keys, impressions, clicks, ctr: impressions ? clicks / impressions : 0, position };
}

test("snapshotRanges ends three days back and spans 7/28/90 inclusive days", () => {
  const r = snapshotRanges(NOW);
  assert.deepEqual(r.d7, { startDate: "2026-10-01", endDate: "2026-10-07" });
  assert.deepEqual(r.d28, { startDate: "2026-09-10", endDate: "2026-10-07" });
  assert.deepEqual(r.d90, { startDate: "2026-07-10", endDate: "2026-10-07" });
});

test("snapshotRanges prev28 is the 28 days directly before d28, with no overlap or gap", () => {
  const r = snapshotRanges(NOW);
  assert.deepEqual(r.prev28, { startDate: "2026-08-13", endDate: "2026-09-09" });
  const dayBefore = new Date(r.d28.startDate);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  assert.equal(dayBefore.toISOString().slice(0, 10), r.prev28.endDate);
});

test("snapshotRanges crosses month and year boundaries", () => {
  const r = snapshotRanges(new Date("2027-01-02T00:00:00Z"));
  assert.equal(r.d7.endDate, "2026-12-30");
  assert.equal(r.d7.startDate, "2026-12-24");
});

test("buildSnapshotPayload keeps the highest-impression queries, trims blanks, attaches pages to d28", () => {
  const ranges = snapshotRanges(NOW);
  const payload = buildSnapshotPayload({
    now: NOW,
    siteUrl: "sc-domain:example.com",
    ranges,
    rows: {
      d7: [row(["a"], 10), row(["b"], 30), row(["  "], 99), row(["zero"], 0)],
      d28: [row(["alpha"], 500, 20), row(["beta"], 900, 5)],
      d90: [],
      prev28: [row(["alpha"], 400)],
      d28Pages: [row(["beta", "https://example.com/b"], 900, 5, 6), row(["beta", "https://example.com/b2"], 100, 1, 9)],
    },
  });

  assert.equal(payload.version, 1);
  assert.equal(payload.capturedAt, NOW.toISOString());
  assert.deepEqual(payload.windows.d7.queries.map((q) => q.query), ["b", "a"]);
  assert.deepEqual(payload.windows.d28.queries.map((q) => q.query), ["beta", "alpha"]);
  assert.deepEqual(payload.windows.d28.queries[0].rankingPages.map((p) => p.url), ["https://example.com/b", "https://example.com/b2"]);
  assert.deepEqual(payload.windows.d28.queries[1].rankingPages, []);
  assert.equal("score" in payload.windows.d28.queries[0], false);
  assert.equal(payload.windows.prev28.queries.length, 1);
});

test("buildSnapshotPayload caps non-main windows at 200 and the main window at 500", () => {
  const many = Array.from({ length: 700 }, (_, i) => row([`q${i}`], 1000 - i));
  const payload = buildSnapshotPayload({
    now: NOW,
    siteUrl: "s",
    ranges: snapshotRanges(NOW),
    rows: { d7: many, d28: many, d90: many, prev28: many, d28Pages: [] },
  });
  assert.equal(payload.windows.d28.queries.length, 500);
  assert.equal(payload.windows.d7.queries.length, 200);
  assert.equal(payload.windows.d90.queries.length, 200);
  assert.equal(payload.windows.prev28.queries.length, 200);
});

test("captureSearchSnapshot asks Search Console for each window once, in parallel-safe calls", async () => {
  const calls: string[] = [];
  const payload = await captureSearchSnapshot(
    async (_site, start, end, dims) => {
      calls.push(`${dims.join("+")}:${start}..${end}`);
      return [row(["x"], 10)];
    },
    "sc-domain:example.com",
    NOW,
  );
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((c) => c.startsWith("query+page")).length, 1);
  assert.ok(calls.includes("query:2026-10-01..2026-10-07"));
  assert.equal(payload.siteUrl, "sc-domain:example.com");
});

test("captureSearchSnapshot propagates a Search Console failure instead of storing partial data", async () => {
  await assert.rejects(
    captureSearchSnapshot(async () => {
      throw new Error("Search Console query failed: HTTP 403");
    }, "s", NOW),
    /HTTP 403/,
  );
});

test("retentionCutoff is the retention window before now", () => {
  const cutoff = retentionCutoff(NOW);
  const days = Math.round((new Date("2026-10-10").getTime() - new Date(cutoff).getTime()) / 86_400_000);
  assert.equal(days, SNAPSHOT_RETENTION_DAYS);
});

test("selectDueProjects skips already-snapshotted and duplicate projects, in stable order", () => {
  const due = selectDueProjects(
    [
      { projectId: "p3", userId: "u" },
      { projectId: "p1", userId: "u" },
      { projectId: "p1", userId: "u" },
      { projectId: "p2", userId: "u" },
    ],
    new Set(["p2"]),
  );
  assert.deepEqual(due.map((d) => d.projectId), ["p1", "p3"]);
});

test("runWithBudget isolates failures and processes everything within budget", async () => {
  const seen: number[] = [];
  const summary = await runWithBudget(
    [1, 2, 3],
    async (n) => {
      if (n === 2) throw new Error("boom");
      seen.push(n);
    },
    { budgetMs: 1000, now: () => 0 },
  );
  assert.deepEqual(seen, [1, 3]);
  assert.equal(summary.processed, 2);
  assert.equal(summary.skipped, 0);
  assert.deepEqual(summary.failed, [{ item: 2, error: "boom" }]);
});

test("runWithBudget stops when the budget is spent and reports the untouched remainder", async () => {
  let clock = 0;
  const summary = await runWithBudget(
    ["a", "b", "c", "d"],
    async () => {
      clock += 400;
    },
    { budgetMs: 1000, now: () => clock },
  );
  assert.equal(summary.processed, 3);
  assert.equal(summary.skipped, 1);
});

test("isAuthorizedCron rejects missing, empty and wrong secrets, including 'Bearer undefined'", () => {
  assert.equal(isAuthorizedCron("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorizedCron("Bearer wrong", "s3cret"), false);
  assert.equal(isAuthorizedCron(null, "s3cret"), false);
  assert.equal(isAuthorizedCron("Bearer undefined", undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", ""), false);
});

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE search_snapshots (
    project_id TEXT NOT NULL, snapshot_date TEXT NOT NULL, payload TEXT NOT NULL, captured_at TEXT NOT NULL,
    PRIMARY KEY (project_id, snapshot_date))`);
  return db;
}

function payloadFor(at: Date) {
  return buildSnapshotPayload({
    now: at,
    siteUrl: "s",
    ranges: snapshotRanges(at),
    rows: { d7: [], d28: [row(["alpha"], 10)], d90: [], prev28: [], d28Pages: [] },
  });
}

test("sqlite store: save then read back the latest snapshot", () => {
  const db = memoryDb();
  assert.equal(getLatestSnapshot(db, "p1"), null);
  saveSnapshot(db, "p1", payloadFor(NOW), NOW);
  const latest = getLatestSnapshot(db, "p1");
  assert.equal(latest?.snapshotDate, "2026-10-10");
  assert.equal(latest?.payload.windows.d28.queries[0].query, "alpha");
  assert.equal(countSnapshots(db, "p1"), 1);
});

test("sqlite store: saving twice on the same day replaces, never duplicates", () => {
  const db = memoryDb();
  saveSnapshot(db, "p1", payloadFor(NOW), NOW);
  saveSnapshot(db, "p1", payloadFor(NOW), new Date("2026-10-10T18:00:00Z"));
  assert.equal(countSnapshots(db, "p1"), 1);
  assert.equal(getLatestSnapshot(db, "p1")?.capturedAt, "2026-10-10T18:00:00.000Z");
});

test("sqlite store: latest wins across days, history is per project, old history is pruned", () => {
  const db = memoryDb();
  const old = new Date(NOW.getTime() - (SNAPSHOT_RETENTION_DAYS + 5) * 86_400_000);
  saveSnapshot(db, "p1", payloadFor(old), old);
  saveSnapshot(db, "p2", payloadFor(NOW), NOW);
  assert.equal(countSnapshots(db, "p1"), 1);

  saveSnapshot(db, "p1", payloadFor(NOW), NOW); // prunes the stale row for p1 only
  assert.equal(countSnapshots(db, "p1"), 1);
  assert.equal(getLatestSnapshot(db, "p1")?.snapshotDate, "2026-10-10");
  assert.equal(countSnapshots(db, "p2"), 1);
});
