import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import type { Finding, FindingSeverity } from "./findingTypes";

type FindingRow = {
  id: string; project_id: string; source: string; category: string; severity: FindingSeverity;
  entity_type: string; entity_id: string; url: string | null; evidence: string;
  recommendation: string; status: Finding["status"]; first_seen: string; last_seen: string; resolved_at: string | null;
};

function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id, projectId: row.project_id, source: row.source, category: row.category,
    severity: row.severity, entityType: row.entity_type, entityId: row.entity_id, url: row.url,
    evidence: JSON.parse(row.evidence || "{}") as Record<string, unknown>,
    recommendation: row.recommendation, status: row.status, firstSeen: row.first_seen,
    lastSeen: row.last_seen, resolvedAt: row.resolved_at,
  };
}

export function listProjectFindings(projectId: string): Finding[] {
  const rows = getDb().prepare(
    "SELECT * FROM findings WHERE project_id = ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen DESC"
  ).all(projectId) as FindingRow[];
  return rows.map(mapFinding);
}

export function upsertFinding(input: {
  projectId: string; source: string; category: string; severity: FindingSeverity;
  entityType: string; entityId: string; url?: string | null;
  evidence: Record<string, unknown>; recommendation: string;
}): Finding {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    "SELECT * FROM findings WHERE project_id = ? AND source = ? AND category = ? AND entity_type = ? AND entity_id = ? AND url IS ? LIMIT 1"
  ).get(input.projectId, input.source, input.category, input.entityType, input.entityId, input.url ?? null) as FindingRow | undefined;

  const id = existing?.id ?? ("finding_" + crypto.randomUUID());
  db.prepare(
    `INSERT INTO findings
      (id, project_id, source, category, severity, entity_type, entity_id, url, evidence, recommendation, status, first_seen, last_seen, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, source, category, entity_type, entity_id, url) DO UPDATE SET
       severity = excluded.severity, evidence = excluded.evidence,
       recommendation = excluded.recommendation, last_seen = excluded.last_seen`
  ).run(
    id, input.projectId, input.source, input.category, input.severity, input.entityType,
    input.entityId, input.url ?? null, JSON.stringify(input.evidence), input.recommendation,
    existing?.status ?? "new", existing?.first_seen ?? now, now, existing?.resolved_at ?? null
  );

  return mapFinding(db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow);
}
