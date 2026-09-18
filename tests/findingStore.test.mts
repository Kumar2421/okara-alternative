import test from "node:test";
import assert from "node:assert/strict";
import { upsertFinding } from "../lib/domain/findings/findingStore";

test("upserts the same finding identity while preserving workflow status", () => {
  const projectId = "test-project";
  const input = {
    projectId,
    source: "search-console",
    category: "search-visibility",
    severity: "warning" as const,
    entityType: "query",
    entityId: "example query",
    url: "https://example.com/page",
    evidence: { position: 8, impressions: 500 },
    recommendation: "Review the ranking page.",
  };
  const first = upsertFinding(input);
  assert.equal(first.status, "new");

  const db = (globalThis as typeof globalThis & { __okaraDb?: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).__okaraDb;
  assert.ok(db);
  db.prepare("UPDATE findings SET status = 'acknowledged' WHERE id = ?").run(first.id);

  const second = upsertFinding({ ...input, severity: "critical", evidence: { position: 6, impressions: 900 } });
  assert.equal(second.id, first.id);
  assert.equal(second.status, "acknowledged");
  assert.equal(second.severity, "critical");
  assert.deepEqual(second.evidence, { position: 6, impressions: 900 });
});
