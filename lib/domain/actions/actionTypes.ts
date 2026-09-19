export const ACTION_TYPES = [
  "add_canonical",
  "remove_noindex",
  "improve_content_relevance",
  "investigate_ttfb",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type ActionStatus = "proposed" | "approved" | "running" | "completed" | "failed" | "cancelled";

export type ActionTarget = {
  url?: string;
  repository?: string;
  branch?: string;
  file?: string;
};

export type Action = {
  id: string;
  projectId: string;
  findingId: string;
  recommendationId?: string;
  type: ActionType;
  status: ActionStatus;
  title: string;
  target: ActionTarget;
  parameters: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  proposed: ["approved", "cancelled"],
  approved: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["approved", "cancelled"],
  cancelled: [],
};

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && ACTION_TYPES.includes(value as ActionType);
}

export function isActionStatus(value: unknown): value is ActionStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_TRANSITIONS, value);
}
