/**
 * FixDelivery abstracts how fixes (e.g., code PRs, manual changes) are tracked
 * and reconciled. Different implementations handle GitHub PRs, future integrations, etc.
 */

export type PRStatus = "open" | "merged" | "closed";

export type FixDeliveryPort = {
  /** Check the status of a PR by its URL. */
  status(prUrl: string): Promise<PRStatus>;
};
