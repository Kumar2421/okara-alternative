import type { Finding } from "../findings/findingTypes.ts";
import { deriveOpportunityRecommendations } from "../search/opportunityRecommendations.ts";
import { sameHost } from "../search/opportunityFinding.ts";
import { buildOpportunities, type SearchOpportunity } from "../search/searchOpportunities.ts";
import type { SearchSnapshotPayload } from "../search/searchSnapshot.ts";
import type { Action, ActionType } from "./actionTypes.ts";
import { actionTarget, autoProposalParameters, AUTO_PROPOSED_KEY, DAILY_PROPOSAL_CAP, isLowRisk, planDailyProposals } from "./autoApprove.ts";
import type { AutomationMode } from "./automationSettings.ts";

/** Everything the job needs from storage, so it runs the same on SQLite and Supabase and is testable with fakes. */
export type DailyProposalPorts = {
  getMode(): Promise<AutomationMode>;
  getSnapshot(): Promise<{ payload: SearchSnapshotPayload } | null>;
  listFindings(): Promise<Finding[]>;
  listActions(): Promise<Action[]>;
  saveFinding(input: {
    projectId: string; source: string; category: string; severity: Finding["severity"]; entityType: string; entityId: string;
    url?: string | null; evidence: Record<string, unknown>; recommendation: string;
  }): Promise<Finding>;
  createAction(input: {
    projectId: string; findingId: string; recommendationId?: string; type: ActionType; title: string;
    target: Action["target"]; parameters: Record<string, unknown>;
  }): Promise<Action>;
  /** proposed -> approved. */
  approveAction(id: string): Promise<unknown>;
  /** Flag an action as auto-approved. Called only after approveAction succeeded. */
  markAutoApproved(id: string): Promise<unknown>;
  /** Claim the (project, UTC day) run; false when another run holds it. */
  claimDay(day: string): Promise<boolean>;
  releaseDay(day: string): Promise<unknown>;
};

export type DailyProposalSummary = {
  mode: AutomationMode;
  findingsCreated: number;
  proposed: number;
  approved: number;
  /** Per-item failure messages only (never secrets or payloads). */
  errors: string[];
};

/**
 * After a daily search snapshot: propose up to 3 fixes and pre-approve only
 * the low-risk ones. Never edits a site, opens a PR or sends email; it only
 * writes findings and actions inside Marlo.
 */
export async function runDailyProposals(
  ports: DailyProposalPorts,
  project: { id: string; name: string | null; url: string | null },
  now: Date = new Date(),
): Promise<DailyProposalSummary> {
  const summary: DailyProposalSummary = { mode: "off", findingsCreated: 0, proposed: 0, approved: 0, errors: [] };
  const mode = await ports.getMode();
  summary.mode = mode;
  if (mode === "off") return summary;

  const snapshot = await ports.getSnapshot();
  if (!snapshot) return summary;

  // One run per project and UTC day may create actions at a time, so overlapping runs cannot double the cap or duplicate a finding's action.
  const day = now.toISOString().slice(0, 10);
  if (!(await ports.claimDay(day))) return summary;
  try {
    await propose(ports, project, snapshot.payload, now, mode, summary);
  } finally {
    await Promise.resolve(ports.releaseDay(day)).catch(() => undefined);
  }
  return summary;
}

async function propose(
  ports: DailyProposalPorts,
  project: { id: string; name: string | null; url: string | null },
  payload: SearchSnapshotPayload,
  now: Date,
  mode: AutomationMode,
  summary: DailyProposalSummary,
): Promise<void> {
  const snapshot = { payload };

  const groups = buildOpportunities(snapshot.payload);
  const opportunities: SearchOpportunity[] = [...groups.ranking, ...groups.ctr, ...groups.declining, ...groups.newQueries, ...groups.lostQueries].map(
    (o) => ({ ...o, pageUrl: o.pageUrl && project.url && sameHost(o.pageUrl, project.url) ? o.pageUrl : null }),
  );

  const [existingFindings, existingActions] = await Promise.all([ports.listFindings(), ports.listActions()]);
  const plan = planDailyProposals({
    opportunities, existingFindings, existingActions, now, mode,
    projectId: project.id, brand: project.name, capturedAt: snapshot.payload.capturedAt,
  });

  for (const item of plan.proposals) {
    try {
      let finding = item.existingFindingId ? existingFindings.find((f) => f.id === item.existingFindingId) : undefined;
      if (!finding) {
        finding = await ports.saveFinding(item.finding);
        summary.findingsCreated += 1;
      }
      const recommendation = deriveOpportunityRecommendations({ id: finding.id, url: finding.url, evidence: finding.evidence })?.[0];
      if (!recommendation) continue;

      // Re-read right before creating: the cap and one-action-per-finding must hold even if another run got in.
      const current = await ports.listActions();
      const today = now.toISOString().slice(0, 10);
      const proposedToday = current.filter((a) => a.parameters?.[AUTO_PROPOSED_KEY] === true && a.createdAt.slice(0, 10) === today).length;
      if (proposedToday >= DAILY_PROPOSAL_CAP) break;
      if (current.some((a) => a.findingId === finding.id && a.status !== "cancelled")) continue;

      const target = actionTarget(finding.url);
      const parameters = autoProposalParameters();
      const action = await ports.createAction({
        projectId: project.id,
        findingId: finding.id,
        recommendationId: recommendation.id,
        type: item.actionType,
        title: recommendation.title,
        target,
        parameters,
      });
      summary.proposed += 1;
      if (item.approve && isLowRisk({ type: item.actionType, target, parameters })) {
        await ports.approveAction(action.id);
        summary.approved += 1;
        // Marker only after the transition succeeded, so a failed approval never leaves a proposed action flagged.
        await ports.markAutoApproved(action.id);
      }
    } catch (err) {
      summary.errors.push(err instanceof Error ? err.message : "Unknown error");
    }
  }
}
