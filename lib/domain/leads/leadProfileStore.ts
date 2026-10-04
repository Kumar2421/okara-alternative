import type Database from "better-sqlite3";
import { normalizeProfile, type LeadProfile } from "./leadProfile.ts";

/** Stored as a `lead_profile` row in project_documents (JSON content), so no schema change is needed in either mode. */
export const LEAD_PROFILE_DOC = "lead_profile";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

export function getLeadProfile(db: Database.Database, projectId: string): LeadProfile | null {
  const row = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(projectId, LEAD_PROFILE_DOC) as { content: string } | undefined;
  if (!row?.content) return null;
  try {
    return normalizeProfile(JSON.parse(row.content));
  } catch {
    return null;
  }
}

export function saveLeadProfile(db: Database.Database, projectId: string, profile: LeadProfile, now = new Date()): void {
  const stamp = now.toISOString();
  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, LEAD_PROFILE_DOC, JSON.stringify(profile), stamp, stamp);
}
