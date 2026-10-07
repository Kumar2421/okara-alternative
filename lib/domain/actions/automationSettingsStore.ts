import type Database from "better-sqlite3";
import { AUTOMATION_DOC, DEFAULT_AUTOMATION, normalizeAutomation, type AutomationSettings } from "./automationSettings.ts";

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
