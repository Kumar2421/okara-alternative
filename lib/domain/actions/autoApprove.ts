import type { Finding } from "../findings/findingTypes.ts";
import { findExistingFinding, findingForOpportunity } from "../search/opportunityFinding.ts";
import type { SearchOpportunity } from "../search/searchOpportunities.ts";
import { deriveActionType } from "./deriveActionType.ts";
import type { Action, ActionType } from "./actionTypes.ts";
import type { AutomationMode } from "./automationSettings.ts";

export const DAILY_PROPOSAL_CAP = 3;

/** Markers the job puts on the actions it proposes, so the daily cap and the UI note can find them. */
export const AUTO_PROPOSED_KEY = "autoProposed";
export const AUTO_APPROVED_KEY = "autoApproved";

/**
 * The only action types Marlo may pre-approve. Each is a suggestion or a
 * to-do the user carries out themselves: nothing leaves Marlo and no site,
 * repository or inbox is touched. An allowlist, so a newly added action type
 * is never auto-approved by accident.
 */
const LOW_RISK_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "rewrite_snippet",
  "improve_content_relevance",
  "investigate_ranking_change",
]);

const RISKY_KEY_PARTS = ["pull", "repo", "branch", "email", "mail", "outreach", "send", "codefix", "code_fix", "prurl", "openpr", "open_pr"];

function hasRiskyKey(record: Record<string, unknown> | undefined): boolean {
  if (!record) return false;
  return Object.keys(record).some((key) => {
    const k = key.toLowerCase();
    return k === "pr" || RISKY_KEY_PARTS.some((part) => k.includes(part));
  });
}

/** True only for copy/suggestion-style actions that change nothing outside Marlo. Anything touching a repo, PR, email or outreach is false. */
export function isLowRisk(action: { type: ActionType; target?: Action["target"]; parameters?: Record<string, unknown> }): boolean {
  if (!LOW_RISK_TYPES.has(action.type)) return false;
  if (action.target?.repository || action.target?.branch || action.target?.file) return false;
  return !hasRiskyKey(action.parameters);
}

/** Parameters an auto-proposed action is created with; used for both the risk check and the create call. */
export function autoProposalParameters(): Record<string, unknown> {
  return { [AUTO_PROPOSED_KEY]: true };
}

export function actionTarget(url: string | null | undefined): Action["target"] {
  return url ? { url } : {};
}

export type PlannedProposal = {
  opportunity: SearchOpportunity;
  /** Finding to save, unless existingFindingId says it is already saved. */
  finding: ReturnType<typeof findingForOpportunity>;
  existingFindingId: string | null;
  actionType: ActionType;
  /** Pre-approve this action. Never true unless the action is low risk and the mode allows it. */
  approve: boolean;
};

export type DailyPlan = { proposals: PlannedProposal[]; remainingToday: number };

type ActionLike = Pick<Action, "findingId" | "status" | "createdAt" | "parameters">;

function utcDay(value: string | Date): string {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

/**
 * Decide today's proposals. Pure and idempotent: the same inputs (plus the
 * actions created by an earlier run) never yield a duplicate finding or
 * action, and the cap counts what was already proposed today.
 */
export function planDailyProposals(args: {
  opportunities: SearchOpportunity[];
  existingFindings: Finding[];
  existingActions: ActionLike[];
  now: Date;
  cap?: number;
  mode: AutomationMode;
  projectId: string;
  brand: string | null;
  capturedAt: string;
}): DailyPlan {
  const cap = args.cap ?? DAILY_PROPOSAL_CAP;

  const today = utcDay(args.now);
  const proposedToday = args.existingActions.filter((a) => a.parameters?.[AUTO_PROPOSED_KEY] === true && utcDay(a.createdAt) === today).length;
  const remaining = Math.max(0, cap - proposedToday);

  const ordered = [...args.opportunities].sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
  const seen = new Set<string>();
  const proposals: PlannedProposal[] = [];

  for (const opportunity of ordered) {
    if (proposals.length >= remaining) break;
    const finding = findingForOpportunity(opportunity, { projectId: args.projectId, brand: args.brand, capturedAt: args.capturedAt });
    const identity = `${finding.entityId}|${finding.url ?? ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const existing = findExistingFinding(args.existingFindings, finding);
    if (existing) {
      // Already tracked: only a brand-new finding with no action yet is picked up. Fixed, failed, in-progress or already-actioned ones are left alone.
      if (existing.status !== "new") continue;
      if (args.existingActions.some((a) => a.findingId === existing.id && a.status !== "cancelled")) continue;
    }

    const actionType = deriveActionType({ source: finding.source, entityId: finding.entityId, evidence: finding.evidence });
    proposals.push({
      opportunity,
      finding,
      existingFindingId: existing?.id ?? null,
      actionType,
      approve: args.mode === "auto_approve_safe" && isLowRisk({ type: actionType, target: actionTarget(finding.url), parameters: autoProposalParameters() }),
    });
  }

  return { proposals, remainingToday: remaining - proposals.length };
}
