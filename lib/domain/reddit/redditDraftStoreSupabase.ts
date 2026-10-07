import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewRedditDraft, RedditDraftPatch, RedditDraftStatus, RedditDraftView, SavedRedditDraft } from "./redditDraftStore";
import { countActiveBatches, reserveBatchSlot, type Reservation } from "@/lib/domain/x/draftGuards";

function map(row: Record<string, unknown>): SavedRedditDraft {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    subreddit: String(row.subreddit ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    status: row.status as RedditDraftStatus,
    angle: row.angle ? String(row.angle) : "General",
    whyThisWorks: row.why_this_works ? String(row.why_this_works) : "",
    edited: Boolean(row.edited),
    batchId: row.batch_id ? String(row.batch_id) : null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function statusesForView(view: RedditDraftView): RedditDraftStatus[] {
  return view === "archived" ? ["completed", "archived"] : ["draft"];
}

export async function listRedditDrafts(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  view: RedditDraftView
): Promise<SavedRedditDraft[]> {
  const { data, error } = await db
    .from("reddit_post_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .in("status", statusesForView(view))
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export async function insertRedditDrafts(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  drafts: NewRedditDraft[],
  batchIdOverride?: string
): Promise<SavedRedditDraft[]> {
  const batchId = batchIdOverride ?? `rdb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const { data, error } = await db
    .from("reddit_post_drafts")
    .insert(
      drafts.map((d) => ({
        user_id: userId,
        project_id: projectId,
        subreddit: d.subreddit,
        title: d.title,
        body: d.body,
        status: "draft",
        angle: d.angle,
        why_this_works: d.whyThisWorks,
        edited: false,
        batch_id: batchId,
        created_at: createdAt,
      }))
    )
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export async function updateRedditDraft(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  id: string,
  patch: RedditDraftPatch
): Promise<SavedRedditDraft | null> {
  const { data: current } = await db
    .from("reddit_post_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (!current) return null;

  const existing = map(current);
  const subreddit = patch.subreddit ?? existing.subreddit;
  const title = patch.title ?? existing.title;
  const body = patch.body ?? existing.body;
  const status = patch.status ?? existing.status;
  const completedAt =
    status === "completed" ? (existing.status === "completed" ? existing.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : existing.completedAt;

  const { data, error } = await db
    .from("reddit_post_drafts")
    .update({
      subreddit,
      title,
      body,
      status,
      edited: existing.edited || subreddit !== existing.subreddit || title !== existing.title || body !== existing.body,
      completed_at: completedAt,
    })
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? map(data) : null;
}

export async function deleteRedditDraft(db: SupabaseClient, userId: string, projectId: string, id: string): Promise<boolean> {
  const { data, error } = await db
    .from("reddit_post_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function countRedditBatchesSince(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  sinceIso: string
): Promise<number> {
  const { data, error } = await db
    .from("reddit_post_drafts")
    .select("batch_id, status, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .not("batch_id", "is", null)
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return countActiveBatches((data ?? []) as { batch_id: string | null; status: string | null; created_at: string }[], sinceIso, Date.now());
}

export async function deleteRedditBatch(db: SupabaseClient, userId: string, projectId: string, batchId: string): Promise<void> {
  const { error } = await db
    .from("reddit_post_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("batch_id", batchId);
  if (error) throw new Error(error.message);
}

export function reserveRedditBatch(db: SupabaseClient, userId: string, projectId: string, limit: number, sinceIso: string): Promise<Reservation> {
  return reserveBatchSlot(
    {
      insert: async (batchId) => {
        const { error } = await db.from("reddit_post_drafts").insert({
          user_id: userId,
          project_id: projectId,
          subreddit: "",
          title: "",
          body: "",
          status: "pending",
          edited: false,
          batch_id: batchId,
        });
        if (error) throw new Error(error.message);
      },
      count: () => countRedditBatchesSince(db, userId, projectId, sinceIso),
      remove: (batchId) => deleteRedditBatch(db, userId, projectId, batchId),
    },
    limit,
    () => `rdb_${crypto.randomUUID()}`
  );
}

export async function fulfilRedditBatch(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  batchId: string,
  drafts: NewRedditDraft[]
): Promise<SavedRedditDraft[]> {
  const inserted = await insertRedditDrafts(db, userId, projectId, drafts, batchId);
  const { error } = await db
    .from("reddit_post_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("batch_id", batchId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return inserted;
}
