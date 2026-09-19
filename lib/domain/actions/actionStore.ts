import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import type { Action, ActionStatus, ActionType } from "./actionTypes";
import { canTransitionAction } from "./actionTypes";

type ActionRow = {
  id: string; project_id: string; finding_id: string; recommendation_id: string | null;
  type: ActionType; status: ActionStatus; title: string; target: string; parameters: string;
  result: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};

function mapAction(row: ActionRow): Action {
  return {
    id: row.id, projectId: row.project_id, findingId: row.finding_id, recommendationId: row.recommendation_id ?? undefined,
    type: row.type, status: row.status, title: row.title,
    target: JSON.parse(row.target || "{}") as Action["target"],
    parameters: JSON.parse(row.parameters || "{}") as Record<string, unknown>,
    result: row.result ? JSON.parse(row.result) as Record<string, unknown> : null,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
  };
}

export function getProjectAction(projectId: string, id: string): Action | null {
  const row = getDb().prepare("SELECT * FROM actions WHERE project_id = ? AND id = ? LIMIT 1").get(projectId, id) as ActionRow | undefined;
  return row ? mapAction(row) : null;
}

export function listProjectActions(projectId: string): Action[] {
  const rows = getDb().prepare("SELECT * FROM actions WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as ActionRow[];
  return rows.map(mapAction);
}

export function createAction(input: {
  projectId: string; findingId: string; recommendationId?: string; type: ActionType; title: string;
  target: Action["target"]; parameters: Record<string, unknown>;
}): Action {
  const id = "action_" + crypto.randomUUID();
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO actions (id, project_id, finding_id, recommendation_id, type, status, title, target, parameters, result, created_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, NULL, ?, NULL, NULL)`
  ).run(id, input.projectId, input.findingId, input.recommendationId ?? null, input.type, input.title, JSON.stringify(input.target), JSON.stringify(input.parameters), now);
  return getProjectAction(input.projectId, id)!;
}

export function transitionAction(projectId: string, id: string, status: ActionStatus, result: Record<string, unknown> | null = null): Action | null {
  const existing = getProjectAction(projectId, id);
  if (!existing) return null;
  if (!canTransitionAction(existing.status, status)) throw new Error(`Invalid action status transition: ${existing.status} -> ${status}`);
  const now = new Date().toISOString();
  const startedAt = status === "running" ? now : existing.startedAt;
  const completedAt = ["completed", "failed", "cancelled"].includes(status) ? now : existing.completedAt;
  getDb().prepare("UPDATE actions SET status = ?, result = ?, started_at = ?, completed_at = ? WHERE project_id = ? AND id = ?")
    .run(status, result === null ? null : JSON.stringify(result), startedAt, completedAt, projectId, id);
  return getProjectAction(projectId, id);
}
