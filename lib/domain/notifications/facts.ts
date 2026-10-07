import { pullRequestUrlOf } from "../fixes/linkPullRequest.ts";
import { implementationOf, savedOutcomeOf } from "../search/actionOutcome.ts";
import type { ActionWithOutcome } from "../search/outcomeService.ts";
import type { SnapshotLike } from "./digest.ts";
import type { MeasuredOutcome, ProjectFacts } from "./job.ts";

/**
 * Turn a project's actions (read through `readOutcomes`) into what the
 * notification job needs. A verdict that is solid but not saved yet became
 * final right now; a saved one carries the time it was saved.
 */
export function projectFactsFromActions(
  project: { id: string; name: string },
  actions: ActionWithOutcome[],
  snapshots: { latest: SnapshotLike | null; weekAgo: SnapshotLike | null },
  now: Date,
): ProjectFacts {
  const measured: MeasuredOutcome[] = [];
  const fixesMade: ProjectFacts["fixesMade"] = [];
  let approvalsWaiting = 0;

  for (const action of actions) {
    if ((action.status === "proposed" || action.status === "approved") && pullRequestUrlOf(action.result)) approvalsWaiting += 1;

    const implementation = action.status === "completed" ? implementationOf(action.result) : null;
    if (!implementation) continue;
    fixesMade.push({ title: action.title, implementedAt: implementation.implementedAt });

    const outcome = action.outcome;
    if (outcome && outcome.confidence === "solid") {
      measured.push({
        actionId: action.id,
        actionTitle: action.title,
        status: outcome.status,
        confidence: outcome.confidence,
        headline: outcome.headline,
        evaluatedAt: savedOutcomeOf(action.result)?.evaluatedAt ?? now.toISOString(),
      });
    }
  }

  return { projectId: project.id, projectName: project.name, measured, fixesMade, ...snapshots, approvalsWaiting };
}
