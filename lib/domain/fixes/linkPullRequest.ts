import type { Action } from "../actions/actionTypes.ts";

/** Where a tracked action remembers the fix PR opened for it (not an implementation yet; that waits for the merge). */
export function pullRequestUrlOf(result: Action["result"]): string | null {
  const pr = (result as { pullRequest?: { url?: unknown } } | null)?.pullRequest;
  return typeof pr?.url === "string" ? pr.url : null;
}

/**
 * When a fix PR is opened for a finding, which of its tracked actions should remember it, and with what result.
 * Only open (proposed/approved) actions that don't already have a PR; completed ones are left alone.
 */
export function linkPullRequest(actions: Action[], prUrl: string): Array<{ id: string; result: Record<string, unknown> }> {
  return actions
    .filter((a) => (a.status === "proposed" || a.status === "approved") && !pullRequestUrlOf(a.result))
    .map((a) => ({ id: a.id, result: { ...(a.result ?? {}), pullRequest: { url: prUrl } } }));
}
