import type { FindingStatus } from "./findingTypes.ts";

/**
 * The steps from a finding's current status to "fixed", one legal transition
 * at a time. Marking a change as made moves its finding forward so the two
 * never disagree; "verified" and "fixed" are left alone.
 */
export function pathToFixed(status: FindingStatus): FindingStatus[] {
  switch (status) {
    case "new":
      return ["acknowledged", "fixing", "fixed"];
    case "acknowledged":
      return ["fixing", "fixed"];
    case "fixing":
      return ["fixed"];
    case "failed":
      return ["fixing", "fixed"];
    case "fixed":
    case "verified":
      return [];
  }
}
