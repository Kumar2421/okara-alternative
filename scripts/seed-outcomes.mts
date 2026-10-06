/**
 * Self-host only. Seeds demo "did my fix work?" data into the local SQLite
 * database so every outcome state can be seen without waiting weeks:
 *
 *   npm run seed:outcomes            add demo fixes to the active project
 *   npm run seed:outcomes -- --clean remove exactly what this script added
 *
 * Everything it writes is tagged ("demo " searches, "action_demo_" ids), and
 * it merges into today's snapshot instead of replacing it, so real data is
 * never overwritten. Run from the frontend folder (it uses ./data/okara.db).
 */
import crypto from "node:crypto";
import { getDb } from "../lib/db.ts";
import { buildDemoRows, DEMO_ACTION_PREFIX, DEMO_PREFIX } from "../lib/domain/search/outcomeDemo.ts";
import { normalizeQuery } from "../lib/domain/search/searchIntent.ts";
import { isoDate, snapshotRanges } from "../lib/domain/search/searchSnapshot.ts";

if (process.env.NEXT_PUBLIC_PLATFORM_MODE === "true") {
  console.error("This seed is for self-host (SQLite) only. Refusing to run in platform mode.");
  process.exit(1);
}

const args = process.argv.slice(2);
const clean = args.includes("--clean");
// getDb() creates any missing tables, so this works on a database the app has not touched yet.
const db = getDb();
const active = db.prepare("SELECT value FROM settings WHERE key = 'active_project_id'").get() as { value: string } | undefined;
if (!active?.value) {
  console.error("No active project. Open the app, create or select a project, then run this again.");
  process.exit(1);
}
const projectId = active.value;
const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;

type Payload = { windows: { d28: { queries: Array<{ query: string }> } } } & Record<string, unknown>;

function removeDemo() {
  const findings = db.prepare("DELETE FROM findings WHERE project_id = ? AND entity_id LIKE ?").run(projectId, `%:${normalizeQuery(DEMO_PREFIX)}%`);
  const actions = db.prepare("DELETE FROM actions WHERE project_id = ? AND id LIKE ?").run(projectId, `${DEMO_ACTION_PREFIX}%`);
  let snapshots = 0;
  for (const snap of db.prepare("SELECT snapshot_date, payload FROM search_snapshots WHERE project_id = ?").all(projectId) as Array<{ snapshot_date: string; payload: string }>) {
    const payload = JSON.parse(snap.payload) as Payload;
    const kept = payload.windows.d28.queries.filter((q) => !q.query.startsWith(DEMO_PREFIX));
    if (kept.length === payload.windows.d28.queries.length) continue;
    payload.windows.d28.queries = kept;
    snapshots += 1;
    db.prepare("UPDATE search_snapshots SET payload = ? WHERE project_id = ? AND snapshot_date = ?").run(JSON.stringify(payload), projectId, snap.snapshot_date);
  }
  return { findings: findings.changes, actions: actions.changes, snapshots };
}

// Always start from a clean slate so running the seed twice never duplicates.
const removed = removeDemo();
if (clean) {
  console.log(`Removed ${removed.findings} demo findings, ${removed.actions} demo actions, cleaned ${removed.snapshots} snapshot(s).`);
  process.exit(0);
}

const now = new Date();
const rows = buildDemoRows({ projectId, projectUrl: project?.url || "https://example.com", now, newId: () => crypto.randomUUID() });

const insertFinding = db.prepare(
  `INSERT INTO findings (id, project_id, source, category, severity, entity_type, entity_id, url, evidence, recommendation, status, first_seen, last_seen, resolved_at)
   VALUES (@id, @projectId, @source, @category, @severity, @entityType, @entityId, @url, @evidence, @recommendation, @status, @firstSeen, @lastSeen, NULL)`,
);
const insertAction = db.prepare(
  `INSERT INTO actions (id, project_id, finding_id, recommendation_id, type, status, title, target, parameters, result, created_at, started_at, completed_at)
   VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, '{}', ?, ?, NULL, ?)`,
);

db.transaction(() => {
  for (const r of rows) {
    insertFinding.run({ ...r.finding, evidence: JSON.stringify(r.finding.evidence), url: r.finding.url });
    insertAction.run(r.action.id, projectId, r.action.findingId, r.action.recommendationId, r.action.type, r.action.title, JSON.stringify(r.action.target), JSON.stringify(r.action.result), r.action.createdAt, r.action.completedAt);
  }

  // Merge the demo searches into today's snapshot (creating one only if none exists).
  const date = isoDate(now);
  const existing = db.prepare("SELECT payload FROM search_snapshots WHERE project_id = ? AND snapshot_date = ?").get(projectId, date) as { payload: string } | undefined;
  const ranges = snapshotRanges(now);
  const payload: Payload = existing
    ? (JSON.parse(existing.payload) as Payload)
    : ({
        version: 1, capturedAt: now.toISOString(), siteUrl: "demo",
        windows: {
          d7: { ...ranges.d7, queries: [] }, d28: { ...ranges.d28, queries: [] }, d90: { ...ranges.d90, queries: [] }, prev28: { ...ranges.prev28, queries: [] },
        },
      } as unknown as Payload);
  payload.windows.d28.queries.push(...rows.map((r) => ({ ...r.snapshotQuery, rankingPages: [] })));
  db.prepare(
    `INSERT INTO search_snapshots (project_id, snapshot_date, payload, captured_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, snapshot_date) DO UPDATE SET payload = excluded.payload`,
  ).run(projectId, date, JSON.stringify(payload), now.toISOString());
})();

console.log(`Seeded ${rows.length} demo fixes into project ${projectId}:`);
for (const r of rows) console.log(`  - ${r.label}: "${r.finding.entityId.split(":")[1]}"`);
console.log("Open Findings and look for the \"demo ...\" items. Remove them with: npm run seed:outcomes -- --clean");
