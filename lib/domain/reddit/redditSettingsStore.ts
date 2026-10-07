import type Database from "better-sqlite3";
import { normalizeRedditSettings, type RedditSettings } from "./redditSettings.ts";

export const REDDIT_SETTINGS_DOC = "reddit_settings";

// Self-host (SQLite) store. Takes the database explicitly so it can be tested in memory.

export function getRedditSettings(db: Database.Database, projectId: string): RedditSettings {
  const row = db
    .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(projectId, REDDIT_SETTINGS_DOC) as { content: string } | undefined;
  if (!row?.content) return normalizeRedditSettings(null);
  try {
    return normalizeRedditSettings(JSON.parse(row.content));
  } catch {
    return normalizeRedditSettings(null);
  }
}

export function saveRedditSettings(db: Database.Database, projectId: string, settings: RedditSettings, now = new Date()): void {
  const stamp = now.toISOString();
  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, REDDIT_SETTINGS_DOC, JSON.stringify(settings), stamp, stamp);
}
