import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewXDraft, XDraft, XDraftPatch, XDraftStatus, XDraftView } from "./xDraftTypes";
import { statusesForView } from "./xDraftTypes";
import { countActiveBatches, reserveBatchSlot, type Reservation } from "./draftGuards";

function map(row: Record<string, unknown>): XDraft {
  return {
    id: String(row.id), projectId: String(row.project_id), text: String(row.body ?? ""), status: row.status as XDraftStatus,
    angle: row.angle ? String(row.angle) : "General", whyThisWorks: row.why_this_works ? String(row.why_this_works) : "",
    edited: Boolean(row.edited), batchId: row.batch_id ? String(row.batch_id) : null,
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export async function listXDrafts(db: SupabaseClient, userId: string, projectId: string, view: XDraftView): Promise<XDraft[]> {
  const { data, error } = await db.from("x_drafts").select("*").eq("user_id", userId).eq("project_id", projectId)
    .in("status", statusesForView(view)).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export async function insertXDrafts(db: SupabaseClient, userId: string, projectId: string, drafts: NewXDraft[], topic = "X post", batchIdOverride?: string): Promise<XDraft[]> {
  const batchId = batchIdOverride ?? `xb_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const { data, error } = await db.from("x_drafts").insert(
    drafts.map((d) => ({
      user_id: userId, project_id: projectId, topic, body: d.text, status: "draft", angle: d.angle,
      why_this_works: d.whyThisWorks, edited: false, batch_id: batchId, created_at: createdAt,
    }))
  ).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export async function updateXDraft(db: SupabaseClient, userId: string, projectId: string, id: string, patch: XDraftPatch): Promise<XDraft | null> {
  const { data: current } = await db.from("x_drafts").select("*").eq("user_id", userId).eq("project_id", projectId).eq("id", id).maybeSingle();
  if (!current) return null;
  const existing = map(current);
  const text = patch.text ?? existing.text;
  const status = patch.status ?? existing.status;
  const completedAt =
    status === "completed" ? (existing.status === "completed" ? existing.completedAt : new Date().toISOString())
    : status === "draft" ? null
    : existing.completedAt;
  const { data, error } = await db.from("x_drafts")
    .update({ body: text, status, edited: existing.edited || text !== existing.text, completed_at: completedAt })
    .eq("user_id", userId).eq("project_id", projectId).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? map(data) : null;
}

export async function deleteXDraft(db: SupabaseClient, userId: string, projectId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from("x_drafts").delete().eq("user_id", userId).eq("project_id", projectId).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function countXBatchesSince(db: SupabaseClient, userId: string, projectId: string, sinceIso: string): Promise<number> {
  const { data, error } = await db.from("x_drafts").select("batch_id, status, created_at").eq("user_id", userId).eq("project_id", projectId)
    .not("batch_id", "is", null).gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return countActiveBatches((data ?? []) as { batch_id: string | null; status: string | null; created_at: string }[], sinceIso, Date.now());
}

/** Remove every row of a batch (a placeholder, or drafts that must be rolled back). */
export async function deleteXBatch(db: SupabaseClient, userId: string, projectId: string, batchId: string): Promise<void> {
  const { error } = await db.from("x_drafts").delete().eq("user_id", userId).eq("project_id", projectId).eq("batch_id", batchId);
  if (error) throw new Error(error.message);
}

/** Claim one of today's batch slots before the model call. A placeholder row ('pending') holds it. */
export function reserveXBatch(db: SupabaseClient, userId: string, projectId: string, limit: number, sinceIso: string): Promise<Reservation> {
  return reserveBatchSlot(
    {
      insert: async (batchId) => {
        const { error } = await db.from("x_drafts").insert({
          user_id: userId, project_id: projectId, topic: "X post", body: "", status: "pending", edited: false, batch_id: batchId,
        });
        if (error) throw new Error(error.message);
      },
      count: () => countXBatchesSince(db, userId, projectId, sinceIso),
      remove: (batchId) => deleteXBatch(db, userId, projectId, batchId),
    },
    limit,
    () => `xb_${crypto.randomUUID()}`
  );
}

/** Swap the placeholder for the real drafts under the same batch id. Rolls the drafts back if the swap fails. */
export async function fulfilXBatch(db: SupabaseClient, userId: string, projectId: string, batchId: string, drafts: NewXDraft[]): Promise<XDraft[]> {
  const inserted = await insertXDrafts(db, userId, projectId, drafts, "X post", batchId);
  const { error } = await db.from("x_drafts").delete().eq("user_id", userId).eq("project_id", projectId).eq("batch_id", batchId).eq("status", "pending");
  if (error) throw new Error(error.message);
  return inserted;
}
