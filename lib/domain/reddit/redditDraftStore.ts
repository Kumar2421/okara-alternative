import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { RedditDraft } from "@/lib/domain/social/draftParse.ts";

export type RedditDraftStatus = "draft" | "completed" | "archived" | "pending";

export function isRedditDraftStatus(value: unknown): value is RedditDraftStatus {
  return typeof value === "string" && ["draft", "completed", "archived", "pending"].includes(value);
}

export type RedditDraftView = "current" | "archived";

export type SavedRedditDraft = {
  id: string;
  projectId: string;
  subreddit: string;
  title: string;
  body: string;
  status: RedditDraftStatus;
  angle: string;
  whyThisWorks: string;
  edited: boolean;
  batchId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NewRedditDraft = RedditDraft & { angle: string; whyThisWorks: string };

export type RedditDraftPatch = { subreddit?: string; title?: string; body?: string; status?: RedditDraftStatus };

type Row = {
  id: string;
  project_id: string;
  subreddit: string;
  title: string;
  body: string;
  status: RedditDraftStatus;
  angle: string | null;
  why_this_works: string | null;
  edited: number | null;
  batch_id: string | null;
  created_at: string;
  completed_at: string | null;
};

function statusesForView(view: RedditDraftView): RedditDraftStatus[] {
  return view === "archived" ? ["completed", "archived"] : ["draft"];
}

function map(row: Row): SavedRedditDraft {
  return {
    id: row.id,
    projectId: row.project_id,
    subreddit: row.subreddit,
    title: row.title,
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

export function getRedditDraft(db: Database.Database, projectId: string, id: string): SavedRedditDraft | null {
  const row = db.prepare("SELECT * FROM reddit_post_drafts WHERE project_id = ? AND id = ?").get(projectId, id) as Row | undefined;
  return row ? map(row) : null;
}

export function listRedditDrafts(db: Database.Database, projectId: string, view: RedditDraftView): SavedRedditDraft[] {
  const statuses = statusesForView(view);
  const rows = db
    .prepare(
      `SELECT * FROM reddit_post_drafts WHERE project_id = ? AND status IN (${statuses.map(() => "?").join(",")})
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(projectId, ...statuses) as Row[];
  return rows.map(map);
}

export function insertRedditDrafts(
  db: Database.Database,
  projectId: string,
  drafts: NewRedditDraft[]
): SavedRedditDraft[] {
  const batchId = `rdb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO reddit_post_drafts (id, project_id, subreddit, title, body, status, angle, why_this_works, edited, batch_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`
  );
  const ids: string[] = [];
  db.transaction(() => {
    for (const d of drafts) {
      const id = `rdb_${crypto.randomUUID()}`;
      insert.run(id, projectId, d.subreddit, d.title, d.body, d.angle, d.whyThisWorks, batchId, createdAt);
      ids.push(id);
    }
  })();
  return ids.map((id) => getRedditDraft(db, projectId, id)).filter((d): d is SavedRedditDraft => d !== null);
}

export function updateRedditDraft(db: Database.Database, projectId: string, id: string, patch: RedditDraftPatch): SavedRedditDraft | null {
  const current = getRedditDraft(db, projectId, id);
  if (!current) return null;

  const subreddit = patch.subreddit ?? current.subreddit;
  const title = patch.title ?? current.title;
  const body = patch.body ?? current.body;
  const status = patch.status ?? current.status;
  const edited =
    current.edited || subreddit !== current.subreddit || title !== current.title || body !== current.body;
  const completedAt =
    status === "completed" ? (current.status === "completed" ? current.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : current.completedAt;

  db.prepare(
    "UPDATE reddit_post_drafts SET subreddit = ?, title = ?, body = ?, status = ?, edited = ?, completed_at = ? WHERE project_id = ? AND id = ?"
  ).run(subreddit, title, body, status, edited ? 1 : 0, completedAt, projectId, id);

  return getRedditDraft(db, projectId, id);
}

export function deleteRedditDraft(db: Database.Database, projectId: string, id: string): boolean {
  return db.prepare("DELETE FROM reddit_post_drafts WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0;
}

/** Distinct generation batches since `sinceIso`, for the daily limit. */
export function countRedditBatchesSince(db: Database.Database, projectId: string, sinceIso: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT batch_id) AS n FROM reddit_post_drafts WHERE project_id = ? AND batch_id IS NOT NULL AND created_at >= ?"
    )
    .get(projectId, sinceIso) as { n: number };
  return row.n;
}
