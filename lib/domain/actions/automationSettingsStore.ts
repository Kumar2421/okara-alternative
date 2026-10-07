import type Database from "better-sqlite3";
import { AUTOMATION_DOC, PROPOSAL_CLAIM_PREFIX, PROPOSAL_CLAIM_STALE_MS, DEFAULT_AUTOMATION, normalizeAutomation, type AutomationSettings } from "./automationSettings.ts";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

export function getAutomationSettings(db: Database.Database, projectId: string): AutomationSettings {
  const row = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(projectId, AUTOMATION_DOC) as { content: string } | undefined;
  if (!row?.content) return { ...DEFAULT_AUTOMATION };
  try {
    return normalizeAutomation(JSON.parse(row.content));
  } catch {
    return { ...DEFAULT_AUTOMATION };
  }
}

/** Atomically claim the daily proposal run for a UTC day. False if another run holds a fresh claim. */
export function claimProposalRun(db: Database.Database, projectId: string, day: string, now = new Date()): boolean {
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - PROPOSAL_CLAIM_STALE_MS).toISOString();
  const result = db
    .prepare(
      `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
       VALUES (?, ?, 'ready', '{}', ?, ?)
       ON CONFLICT(project_id, doc_type) DO UPDATE SET updated_at = excluded.updated_at WHERE project_documents.updated_at < ?`,
    )
    .run(projectId, PROPOSAL_CLAIM_PREFIX + day, stamp, stamp, cutoff);
  return result.changes > 0;
}

export function releaseProposalRun(db: Database.Database, projectId: string, day: string): void {
  db.prepare("DELETE FROM project_documents WHERE project_id = ? AND doc_type = ?").run(projectId, PROPOSAL_CLAIM_PREFIX + day);
}

export function saveAutomationSettings(db: Database.Database, projectId: string, settings: AutomationSettings, now = new Date()): AutomationSettings {
  const stamp = now.toISOString();
  const saved: AutomationSettings = { mode: settings.mode, updatedAt: stamp };
  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, AUTOMATION_DOC, JSON.stringify(saved), stamp, stamp);
  return saved;
}
