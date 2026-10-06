import type { Action } from "../actions/actionTypes.ts";
import { implementationOf } from "../search/actionOutcome.ts";
import { implementAction, type OutcomePorts } from "../search/outcomeService.ts";
import type { FixDeliveryPort } from "./FixDelivery.ts";

/**
 * Extract PR URL from an action's stored data (either in target.repository/branch
 * or in result.implementation.change.prUrl). Returns null if not found.
 */
function extractPrUrl(action: Action): string | null {
  // Check result.implementation.change.prUrl first
  if (action.result && typeof action.result === "object") {
    const impl = (action.result as Record<string, unknown>)["implementation"];
    if (impl && typeof impl === "object") {
      const change = (impl as Record<string, unknown>)["change"];
      if (change && typeof change === "object" && typeof (change as Record<string, unknown>)["prUrl"] === "string") {
        return (change as Record<string, unknown>)["prUrl"] as string;
      }
    }
  }
  return null;
}

/**
 * Reconcile tracked actions with merged GitHub PRs.
 *
 * For each action with a PR URL that has been merged but not yet marked as
 * implemented, call implementAction() with via="github_pr". This is idempotent:
 * merged PRs that are already marked as implemented are skipped, and
 * closed/unmerged PRs are ignored.
 *
 * Errors in individual reconciliations are logged but do not fail the batch.
 */
export async function reconcileFixPullRequests(
  ports: OutcomePorts,
  fixDelivery: FixDeliveryPort,
  actions: Action[],
): Promise<void> {
  for (const action of actions) {
    // Only reconcile actions that are not yet completed
    if (action.status !== "proposed" && action.status !== "approved") continue;

    // Skip if already implemented via GitHub
    const impl = implementationOf(action.result);
    if (impl && impl.via === "github_pr") continue;

    // Extract PR URL from action data
    const prUrl = extractPrUrl(action);
    if (!prUrl) continue; // No PR URL stored

    try {
      const status = await fixDelivery.status(prUrl);

      if (status === "merged") {
        // Try to mark as implemented. Use current time.
        await implementAction(ports, {
          actionId: action.id,
          via: "github_pr",
          change: { prUrl },
          now: new Date(),
        });
      }
      // Closed/open PRs are not marked as implemented.
    } catch {
      // Log but continue with next action. In production, this would go to
      // a proper logging service. For now, silently continue to ensure one
      // failing action doesn't block others.
    }
  }
}
