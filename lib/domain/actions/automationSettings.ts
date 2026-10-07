/** Stored as an `automation_settings` row in project_documents (JSON content), so no schema change is needed in either mode. */
export const AUTOMATION_DOC = "automation_settings";

/** "off" = Ask me: Marlo still suggests up to 3 fixes a day but approves none. "auto_approve_safe" also pre-approves the safe ones. */
export type AutomationMode = "off" | "auto_approve_safe";

export type AutomationSettings = { mode: AutomationMode; updatedAt: string | null };

/** Per-(project, UTC day) run claim, stored as a project_documents row so no schema change is needed. */
export const PROPOSAL_CLAIM_PREFIX = "auto_propose_claim:";
/** Marks that the daily proposal step finished for a project on a UTC day, so the cron does not redo it every run. */
export const PROPOSAL_DONE_PREFIX = "auto_propose_done:";
/** A claim older than this is treated as abandoned (the run died) and may be taken over. */
export const PROPOSAL_CLAIM_STALE_MS = 10 * 60 * 1000;

export const DEFAULT_AUTOMATION: AutomationSettings = { mode: "off", updatedAt: null };

/** Anything that is not exactly the opt-in value is "off", so a corrupt or old row can never turn automation on. */
export function normalizeAutomation(raw: unknown): AutomationSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AUTOMATION };
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === "auto_approve_safe" ? "auto_approve_safe" : "off",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

export function isAutomationMode(value: unknown): value is AutomationMode {
  return value === "off" || value === "auto_approve_safe";
}
