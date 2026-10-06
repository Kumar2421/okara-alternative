import type { Action } from "../actions/actionTypes.ts";
import { implementationOf } from "../search/actionOutcome.ts";
import { implementAction, type OutcomePorts } from "../search/outcomeService.ts";
import type { FixDeliveryPort } from "./FixDelivery.ts";

export type ReconcileResult = {
  implemented: number;
  skipped: number;
  failed: Array<{ actionId: string; error: string }>;
};

/**
 * Extract PR URL from an action's stored data (result.implementation.change.prUrl).
 */
function extractPrUrl(action: Action): string | null {
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
 * implemented, call implementAction() with via="github_pr" using the actual
 * merge timestamp from GitHub. Idempotent: already-implemented actions are
 * skipped, closed/unmerged PRs are ignored.
 *
 * Returns a summary; failures are logged (without secrets) but don't block others.
 */
export async function reconcileFixPullRequests(
  ports: OutcomePorts,
  fixDelivery: FixDeliveryPort,
  actions: Action[],
): Promise<ReconcileResult> {
  const result: ReconcileResult = { implemented: 0, skipped: 0, failed: [] };

  for (const action of actions) {
    // Only reconcile actions that are not yet completed
    if (action.status !== "proposed" && action.status !== "approved") {
      result.skipped += 1;
      continue;
    }

    // Skip if already implemented via GitHub
    const impl = implementationOf(action.result);
    if (impl && impl.via === "github_pr") {
      result.skipped += 1;
      continue;
    }

    // Extract PR URL from action data
    const prUrl = extractPrUrl(action);
    if (!prUrl) {
      result.skipped += 1;
      continue;
    }

    try {
      const prInfo = await fixDelivery.status(prUrl);

      if (prInfo.state === "merged" && prInfo.mergedAt) {
        // Mark as implemented with actual merge time
        const implementResult = await implementAction(ports, {
          actionId: action.id,
          via: "github_pr",
          change: { prUrl },
          now: new Date(prInfo.mergedAt),
        });
        if (implementResult.ok) {
          result.implemented += 1;
        } else {
          result.failed.push({
            actionId: action.id,
            error: `implementAction failed: ${implementResult.error}`,
          });
        }
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ actionId: action.id, error: msg });
      // Warn without revealing secrets
      console.warn(`[reconcileFixPullRequests] Failed to reconcile action ${action.id}: ${msg}`);
    }
  }

  if (result.failed.length > 0) {
    console.warn(`[reconcileFixPullRequests] ${result.failed.length} action(s) failed reconciliation`);
  }

  return result;
}
