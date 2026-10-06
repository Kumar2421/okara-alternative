import type { FixDeliveryPort, PRStatus, PRInfo } from "./FixDelivery.ts";

/**
 * Fake FixDelivery for tests. Maintains an in-memory record of PR statuses and merge times.
 */
export function fixDeliveryFake(): FixDeliveryPort & {
  setState(prUrl: string, status: PRStatus, mergedAt?: string): void;
} {
  const prs = new Map<string, PRInfo>();

  return {
    status: async (prUrl) => {
      return prs.get(prUrl) ?? { state: "open" };
    },
    setState(prUrl: string, status: PRStatus, mergedAt?: string) {
      prs.set(prUrl, { state: status, mergedAt: status === "merged" ? mergedAt : undefined });
    },
  };
}
