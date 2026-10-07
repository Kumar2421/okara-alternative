import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewXDraft, XDraft, XDraftPatch, XDraftStatus, XDraftView } from "./xDraftTypes";
import { statusesForView } from "./xDraftTypes";

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

export async function insertXDrafts(db: SupabaseClient, userId: string, projectId: string, drafts: NewXDraft[], topic = "X post"): Promise<XDraft[]> {
  const batchId = `xb_${crypto.randomUUID()}`;
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
  const { data, error } = await db.from("x_drafts").select("batch_id").eq("user_id", userId).eq("project_id", projectId)
    .not("batch_id", "is", null).gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.batch_id)).size;
}
