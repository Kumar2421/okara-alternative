import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { NewXDraft, XDraft, XDraftPatch, XDraftStatus, XDraftView } from "./xDraftTypes.ts";
import { statusesForView } from "./xDraftTypes.ts";

type Row = {
  id: string; project_id: string; body: string; status: XDraftStatus; angle: string | null;
  why_this_works: string | null; edited: number | null; batch_id: string | null;
  created_at: string; completed_at: string | null;
};

/** Additive columns on the legacy x_drafts table; safe to run on every startup. */
export function ensureXDraftColumns(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(x_drafts)").all() as { name: string }[]).map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE x_drafts ADD COLUMN ${name} ${ddl}`);
  };
  add("project_id", "TEXT");
  add("angle", "TEXT");
  add("why_this_works", "TEXT");
  add("edited", "INTEGER NOT NULL DEFAULT 0");
  add("completed_at", "TEXT");
  add("batch_id", "TEXT");
}

function map(row: Row): XDraft {
  return {
    id: row.id, projectId: row.project_id, text: row.body, status: row.status,
    angle: row.angle ?? "General", whyThisWorks: row.why_this_works ?? "", edited: Boolean(row.edited),
    batchId: row.batch_id, createdAt: row.created_at, completedAt: row.completed_at,
  };
}

export function getXDraft(db: Database.Database, projectId: string, id: string): XDraft | null {
  const row = db.prepare("SELECT * FROM x_drafts WHERE project_id = ? AND id = ?").get(projectId, id) as Row | undefined;
  return row ? map(row) : null;
}

export function listXDrafts(db: Database.Database, projectId: string, view: XDraftView): XDraft[] {
  const statuses = statusesForView(view);
  const rows = db
    .prepare(`SELECT * FROM x_drafts WHERE project_id = ? AND status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at DESC, rowid DESC`)
    .all(projectId, ...statuses) as Row[];
  return rows.map(map);
}

export function insertXDrafts(db: Database.Database, projectId: string, drafts: NewXDraft[], topic = "X post"): XDraft[] {
  const batchId = `xb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO x_drafts (id, project_id, topic, body, status, angle, why_this_works, edited, batch_id, created_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`
  );
  const ids: string[] = [];
  db.transaction(() => {
    for (const d of drafts) {
      const id = `xd_${crypto.randomUUID()}`;
      insert.run(id, projectId, topic, d.text, d.angle, d.whyThisWorks, batchId, createdAt);
      ids.push(id);
    }
  })();
  return ids.map((id) => getXDraft(db, projectId, id)).filter((d): d is XDraft => d !== null);
}

export function updateXDraft(db: Database.Database, projectId: string, id: string, patch: XDraftPatch): XDraft | null {
  const current = getXDraft(db, projectId, id);
  if (!current) return null;
  const text = patch.text ?? current.text;
  const status = patch.status ?? current.status;
  const edited = current.edited || text !== current.text;
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : current.completedAt;
  db.prepare("UPDATE x_drafts SET body = ?, status = ?, edited = ?, completed_at = ? WHERE project_id = ? AND id = ?")
    .run(text, status, edited ? 1 : 0, completedAt, projectId, id);
  return getXDraft(db, projectId, id);
}

export function deleteXDraft(db: Database.Database, projectId: string, id: string): boolean {
  return db.prepare("DELETE FROM x_drafts WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0;
}

/** Distinct generation batches since `sinceIso`, for the daily limit. */
export function countXBatchesSince(db: Database.Database, projectId: string, sinceIso: string): number {
  const row = db
    .prepare("SELECT COUNT(DISTINCT batch_id) AS n FROM x_drafts WHERE project_id = ? AND batch_id IS NOT NULL AND created_at >= ?")
    .get(projectId, sinceIso) as { n: number };
  return row.n;
}
