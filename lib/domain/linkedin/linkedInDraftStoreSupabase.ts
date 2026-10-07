import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewLinkedInDraft, LinkedInDraftPatch, LinkedInDraftStatus, LinkedInDraftView, SavedLinkedInDraft } from "./linkedInDraftStore";
import { countActiveBatches, reserveBatchSlot, type Reservation } from "@/lib/domain/x/draftGuards";

function map(row: Record<string, unknown>): SavedLinkedInDraft {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    hookLine: String(row.hook_line ?? ""),
    body: String(row.body ?? ""),
    status: row.status as LinkedInDraftStatus,
    angle: row.angle ? String(row.angle) : "General",
    whyThisWorks: row.why_this_works ? String(row.why_this_works) : "",
    edited: Boolean(row.edited),
    batchId: row.batch_id ? String(row.batch_id) : null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function statusesForView(view: LinkedInDraftView): LinkedInDraftStatus[] {
  return view === "archived" ? ["completed", "archived"] : ["draft"];
}

export async function listLinkedInDrafts(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  view: LinkedInDraftView
): Promise<SavedLinkedInDraft[]> {
  const { data, error } = await db
    .from("linkedin_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .in("status", statusesForView(view))
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export async function insertLinkedInDrafts(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  drafts: NewLinkedInDraft[],
  topic = "LinkedIn post",
  batchIdOverride?: string
): Promise<SavedLinkedInDraft[]> {
  const batchId = batchIdOverride ?? `ldb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const { data, error } = await db
    .from("linkedin_drafts")
    .insert(
      drafts.map((d) => ({
        user_id: userId,
        project_id: projectId,
        topic,
        hook_line: d.hookLine,
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

export async function updateLinkedInDraft(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  id: string,
  patch: LinkedInDraftPatch
): Promise<SavedLinkedInDraft | null> {
  const { data: current } = await db
    .from("linkedin_drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (!current) return null;

  const existing = map(current);
  const hookLine = patch.hookLine ?? existing.hookLine;
  const body = patch.body ?? existing.body;
  const status = patch.status ?? existing.status;
  const completedAt =
    status === "completed" ? (existing.status === "completed" ? existing.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : existing.completedAt;

  const { data, error } = await db
    .from("linkedin_drafts")
    .update({
      hook_line: hookLine,
      body,
      status,
      edited: existing.edited || hookLine !== existing.hookLine || body !== existing.body,
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

export async function deleteLinkedInDraft(db: SupabaseClient, userId: string, projectId: string, id: string): Promise<boolean> {
  const { data, error } = await db
    .from("linkedin_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function countLinkedInBatchesSince(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  sinceIso: string
): Promise<number> {
  const { data, error } = await db
    .from("linkedin_drafts")
    .select("batch_id, status, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .not("batch_id", "is", null)
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return countActiveBatches((data ?? []) as { batch_id: string | null; status: string | null; created_at: string }[], sinceIso, Date.now());
}

export async function deleteLinkedInBatch(db: SupabaseClient, userId: string, projectId: string, batchId: string): Promise<void> {
  const { error } = await db
    .from("linkedin_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("batch_id", batchId);
  if (error) throw new Error(error.message);
}

export function reserveLinkedInBatch(db: SupabaseClient, userId: string, projectId: string, limit: number, sinceIso: string): Promise<Reservation> {
  return reserveBatchSlot(
    {
      insert: async (batchId) => {
        const { error } = await db.from("linkedin_drafts").insert({
          user_id: userId,
          project_id: projectId,
          topic: "LinkedIn post",
          hook_line: "",
          body: "",
          status: "pending",
          edited: false,
          batch_id: batchId,
        });
        if (error) throw new Error(error.message);
      },
      count: () => countLinkedInBatchesSince(db, userId, projectId, sinceIso),
      remove: (batchId) => deleteLinkedInBatch(db, userId, projectId, batchId),
    },
    limit,
    () => `ldb_${crypto.randomUUID()}`
  );
}

export async function fulfilLinkedInBatch(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  batchId: string,
  drafts: NewLinkedInDraft[]
): Promise<SavedLinkedInDraft[]> {
  const inserted = await insertLinkedInDrafts(db, userId, projectId, drafts, "LinkedIn post", batchId);
  const { error } = await db
    .from("linkedin_drafts")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("batch_id", batchId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return inserted;
}
