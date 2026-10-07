/** Stored as an `automation_settings` row in project_documents (JSON content), so no schema change is needed in either mode. */
export const AUTOMATION_DOC = "automation_settings";

/** "off" = Ask me (Marlo proposes nothing on its own). */
export type AutomationMode = "off" | "auto_approve_safe";

export type AutomationSettings = { mode: AutomationMode; updatedAt: string | null };

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
