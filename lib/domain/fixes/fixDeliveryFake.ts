import type { FixDeliveryPort, PRStatus } from "./FixDelivery.ts";

/**
 * Fake FixDelivery for tests. Maintains an in-memory record of PR statuses.
 */
export function fixDeliveryFake(): FixDeliveryPort & { setState(prUrl: string, status: PRStatus): void } {
  const statuses = new Map<string, PRStatus>();

  return {
    status: async (prUrl) => {
      return statuses.get(prUrl) ?? "open";
    },
    setState(prUrl: string, status: PRStatus) {
      statuses.set(prUrl, status);
    },
  };
}
