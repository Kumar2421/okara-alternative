/**
 * Calculate totals from snapshot queries: sum clicks/impressions and
 * impressions-weighted average position.
 * Pure logic for the overview panel.
 */

import type { SnapshotWindow } from "./searchSnapshot.ts";

export type SummaryTotals = {
  clicks: number;
  impressions: number;
  position: number;
};

type QueryLike = { clicks: number; impressions: number; position: number };

/**
 * Compute totals from a snapshot window or list of queries.
 * @param window The snapshot window or window-like object with queries array
 * @returns Totals with impressions-weighted average position, guards divide-by-zero
 */
export function summaryTotals(window: SnapshotWindow | { queries: QueryLike[] } | null | undefined): SummaryTotals {
  const queries = window && "queries" in window ? window.queries : null;
  if (!queries || queries.length === 0) {
    return { clicks: 0, impressions: 0, position: 0 };
  }

  let totalClicks = 0;
  let totalImpressions = 0;
  let positionSum = 0;

  for (const q of queries) {
    totalClicks += q.clicks;
    totalImpressions += q.impressions;
    positionSum += q.position * q.impressions;
  }

  const position = totalImpressions > 0 ? positionSum / totalImpressions : 0;
  return { clicks: totalClicks, impressions: totalImpressions, position };
}
