import type { FindingSeverity, FindingStatus } from "./findingTypes.ts";

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Resolved findings sort last regardless of severity — otherwise an old,
 * already-fixed critical finding (still carrying severity: "critical")
 * outranks a live, unresolved warning, directly undermining "what should I
 * fix first." "failed" (recheck ran, issue confirmed still present) stays
 * ranked by severity like any other active finding.
 *
 * The self-host SQLite store (findingStore.ts) applies the same policy as a
 * raw SQL ORDER BY, since it can sort in the query itself; this is the
 * platform/Supabase store's version, and the one pure enough to unit test
 * directly.
 */
export function compareFindingsByPriority(
  a: { status: FindingStatus; severity: FindingSeverity },
  b: { status: FindingStatus; severity: FindingSeverity },
): number {
  const aResolved = a.status === "verified" ? 1 : 0;
  const bResolved = b.status === "verified" ? 1 : 0;
  if (aResolved !== bResolved) return aResolved - bResolved;
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}
