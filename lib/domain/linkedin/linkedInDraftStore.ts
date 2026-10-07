import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { LinkedInDraft } from "@/lib/domain/social/draftParse.ts";

export type LinkedInDraftStatus = "draft" | "completed" | "archived" | "pending";

export function isLinkedInDraftStatus(value: unknown): value is LinkedInDraftStatus {
  return typeof value === "string" && ["draft", "completed", "archived", "pending"].includes(value);
}

export type LinkedInDraftView = "current" | "archived";

export type SavedLinkedInDraft = {
  id: string;
  projectId: string;
  hookLine: string;
  body: string;
  status: LinkedInDraftStatus;
  angle: string;
  whyThisWorks: string;
  edited: boolean;
  batchId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NewLinkedInDraft = LinkedInDraft & { angle: string; whyThisWorks: string };

export type LinkedInDraftPatch = { hookLine?: string; body?: string; status?: LinkedInDraftStatus };

type Row = {
  id: string;
  project_id: string;
  hook_line: string;
  body: string;
  status: LinkedInDraftStatus;
  angle: string | null;
  why_this_works: string | null;
  edited: number | null;
  batch_id: string | null;
  created_at: string;
  completed_at: string | null;
};

function statusesForView(view: LinkedInDraftView): LinkedInDraftStatus[] {
  return view === "archived" ? ["completed", "archived"] : ["draft"];
}

function map(row: Row): SavedLinkedInDraft {
  return {
    id: row.id,
    projectId: row.project_id,
    hookLine: row.hook_line,
    body: row.body,
    status: row.status,
    angle: row.angle ?? "General",
    whyThisWorks: row.why_this_works ?? "",
    edited: Boolean(row.edited),
    batchId: row.batch_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function getLinkedInDraft(db: Database.Database, projectId: string, id: string): SavedLinkedInDraft | null {
  const row = db
    .prepare("SELECT * FROM linkedin_drafts WHERE project_id = ? AND id = ?")
    .get(projectId, id) as Row | undefined;
  return row ? map(row) : null;
}

export function listLinkedInDrafts(db: Database.Database, projectId: string, view: LinkedInDraftView): SavedLinkedInDraft[] {
  const statuses = statusesForView(view);
  const rows = db
    .prepare(
      `SELECT * FROM linkedin_drafts WHERE project_id = ? AND status IN (${statuses.map(() => "?").join(",")})
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(projectId, ...statuses) as Row[];
  return rows.map(map);
}

export function insertLinkedInDrafts(
  db: Database.Database,
  projectId: string,
  drafts: NewLinkedInDraft[],
  topic = "LinkedIn post"
): SavedLinkedInDraft[] {
  const batchId = `ldb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO linkedin_drafts (id, project_id, topic, hook_line, body, status, angle, why_this_works, edited, batch_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`
  );
  const ids: string[] = [];
  db.transaction(() => {
    for (const d of drafts) {
      const id = `ldb_${crypto.randomUUID()}`;
      insert.run(id, projectId, topic, d.hookLine, d.body, d.angle, d.whyThisWorks, batchId, createdAt);
      ids.push(id);
    }
  })();
  return ids.map((id) => getLinkedInDraft(db, projectId, id)).filter((d): d is SavedLinkedInDraft => d !== null);
}

export function updateLinkedInDraft(db: Database.Database, projectId: string, id: string, patch: LinkedInDraftPatch): SavedLinkedInDraft | null {
  const current = getLinkedInDraft(db, projectId, id);
  if (!current) return null;

  const hookLine = patch.hookLine ?? current.hookLine;
  const body = patch.body ?? current.body;
  const status = patch.status ?? current.status;
  const edited = current.edited || hookLine !== current.hookLine || body !== current.body;
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : current.completedAt;

  db.prepare(
    "UPDATE linkedin_drafts SET hook_line = ?, body = ?, status = ?, edited = ?, completed_at = ? WHERE project_id = ? AND id = ?"
  ).run(hookLine, body, status, edited ? 1 : 0, completedAt, projectId, id);

  return getLinkedInDraft(db, projectId, id);
}

export function deleteLinkedInDraft(db: Database.Database, projectId: string, id: string): boolean {
  return db.prepare("DELETE FROM linkedin_drafts WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0;
}

/** Distinct generation batches since `sinceIso`, for the daily limit. */
export function countLinkedInBatchesSince(db: Database.Database, projectId: string, sinceIso: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT batch_id) AS n FROM linkedin_drafts WHERE project_id = ? AND batch_id IS NOT NULL AND created_at >= ?"
    )
    .get(projectId, sinceIso) as { n: number };
  return row.n;
}
