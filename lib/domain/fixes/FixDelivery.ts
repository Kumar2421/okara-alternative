/**
 * FixDelivery abstracts how fixes (e.g., code PRs, manual changes) are tracked
 * and reconciled. Different implementations handle GitHub PRs, future integrations, etc.
 */

export type PRStatus = "open" | "merged" | "closed";

export type PRInfo = {
  state: PRStatus;
  mergedAt?: string; // ISO 8601 timestamp when PR was merged, undefined if not merged
};

export type FixDeliveryPort = {
  /** Check the status of a PR by its URL, returning state and optional merge time. */
  status(prUrl: string): Promise<PRInfo>;
};
