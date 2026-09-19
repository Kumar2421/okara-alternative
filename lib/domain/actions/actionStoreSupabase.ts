import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action, ActionStatus, ActionType } from "./actionTypes";
import { canTransitionAction } from "./actionTypes";

function mapRow(row: Record<string, unknown>): Action {
  return {
    id: String(row.id), projectId: String(row.project_id), findingId: String(row.finding_id),
    recommendationId: row.recommendation_id ? String(row.recommendation_id) : undefined,
    type: row.type as ActionType, status: row.status as ActionStatus, title: String(row.title),
    target: (row.target ?? {}) as Action["target"], parameters: (row.parameters ?? {}) as Record<string, unknown>,
    result: row.result ? row.result as Record<string, unknown> : null,
    createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export async function getProjectAction(db: SupabaseClient, userId: string, projectId: string, id: string): Promise<Action | null> {
  const { data: project } = await db.from("projects").select("id").eq("id", projectId).eq("owner_id", userId).maybeSingle();
  if (!project) return null;
  const { data } = await db.from("actions").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  return data ? mapRow(data) : null;
}

export async function listProjectActions(db: SupabaseClient, userId: string, projectId: string): Promise<Action[]> {
  const { data: project } = await db.from("projects").select("id").eq("id", projectId).eq("owner_id", userId).maybeSingle();
  if (!project) return [];
  const { data } = await db.from("actions").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  return (data ?? []).map(mapRow);
}

export async function createAction(db: SupabaseClient, userId: string, input: {
  projectId: string; findingId: string; recommendationId?: string; type: ActionType; title: string;
  target: Action["target"]; parameters: Record<string, unknown>;
}): Promise<Action> {
  const { data: project } = await db.from("projects").select("id").eq("id", input.projectId).eq("owner_id", userId).maybeSingle();
  if (!project) throw new Error("Project not found.");
  const id = "action_" + crypto.randomUUID();
  const { data, error } = await db.from("actions").insert({
    id, project_id: input.projectId, finding_id: input.findingId, recommendation_id: input.recommendationId ?? null,
    type: input.type, status: "proposed", title: input.title, target: input.target, parameters: input.parameters,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function transitionAction(db: SupabaseClient, userId: string, projectId: string, id: string, status: ActionStatus, result: Record<string, unknown> | null = null): Promise<Action | null> {
  const existing = await getProjectAction(db, userId, projectId, id);
  if (!existing) return null;
  if (!canTransitionAction(existing.status, status)) throw new Error(`Invalid action status transition: ${existing.status} -> ${status}`);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, result };
  if (status === "running") patch.started_at = now;
  if (["completed", "failed", "cancelled"].includes(status)) patch.completed_at = now;
  const { data, error } = await db.from("actions").update(patch).eq("project_id", projectId).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}
