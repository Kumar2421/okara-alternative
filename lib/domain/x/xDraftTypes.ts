export const X_DRAFT_STATUSES = ["draft", "completed", "archived"] as const;
export type XDraftStatus = (typeof X_DRAFT_STATUSES)[number];

export function isXDraftStatus(value: unknown): value is XDraftStatus {
  return typeof value === "string" && (X_DRAFT_STATUSES as readonly string[]).includes(value);
}

/** "current" = still to review; "archived" = completed or archived. */
export type XDraftView = "current" | "archived";

export type XDraft = {
  id: string;
  projectId: string;
  text: string;
  status: XDraftStatus;
  angle: string;
  whyThisWorks: string;
  /** True once the user changed the generated text. */
  edited: boolean;
  batchId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NewXDraft = { text: string; angle: string; whyThisWorks: string };

export type XDraftPatch = { text?: string; status?: XDraftStatus };

export function statusesForView(view: XDraftView): XDraftStatus[] {
  return view === "archived" ? ["completed", "archived"] : ["draft"];
}

/** Free hosted accounts get a small number of generation batches per day; everyone else, and self-host, is unlimited (-1). */
export function dailyDraftBatchLimit(plan: "free" | "lite" | "pro" | "selfhost"): number {
  if (plan === "free") return 5;
  if (plan === "lite") return 20;
  return -1;
}
