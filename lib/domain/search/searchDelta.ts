import { TOP_QUERIES_MAIN, TOP_QUERIES_OTHER, type SnapshotQuery } from "./searchSnapshot.ts";

export type QueryTrend = "up" | "down" | "stable" | "new" | "lost";

export type QueryChange = {
  query: string;
  trend: QueryTrend;
  current: SnapshotQuery | null;
  previous: SnapshotQuery | null;
  /** current − previous; positive position change means the page moved DOWN the results. */
  positionChange: number | null;
  impressionsChange: number;
  clicksChange: number;
};

/** A query needs at least this many views to count as "new" or "lost". */
export const MIN_VIEWS_FOR_CHANGE = 50;
/** Position change (in places) that counts as a real move rather than noise. */
export const POSITION_MOVE = 2;
/** Relative drop in views that counts as declining even if position held. */
export const VIEWS_DROP_RATIO = 0.3;
/** Don't call a move real unless the query had meaningful volume before. */
const MIN_VIEWS_FOR_TREND = 100;

/**
 * Compare two windows query by query.
 *
 * The stored windows are truncated to the top-N queries by views, so a query
 * missing from one side is not necessarily gone or new. When a list is full,
 * its smallest entry is the visibility floor: a query below that floor could
 * simply have been cut. We only claim "new" or "lost" when it clears the floor.
 */
export function compareWindows(current: SnapshotQuery[], previous: SnapshotQuery[]): QueryChange[] {
  const currentByQuery = new Map(current.map((q) => [q.query, q]));
  const previousByQuery = new Map(previous.map((q) => [q.query, q]));
  const currentFloor = current.length >= TOP_QUERIES_MAIN ? Math.min(...current.map((q) => q.impressions)) : 0;
  const previousFloor = previous.length >= TOP_QUERIES_OTHER ? Math.min(...previous.map((q) => q.impressions)) : 0;

  const changes: QueryChange[] = [];

  for (const now of current) {
    const before = previousByQuery.get(now.query) ?? null;
    if (!before) {
      const isNew = now.impressions >= MIN_VIEWS_FOR_CHANGE && now.impressions > previousFloor;
      changes.push(change(now.query, isNew ? "new" : "stable", now, null));
      continue;
    }
    changes.push(change(now.query, trendFor(now, before), now, before));
  }

  for (const before of previous) {
    if (currentByQuery.has(before.query)) continue;
    const isLost = before.impressions >= MIN_VIEWS_FOR_CHANGE && before.impressions > currentFloor;
    changes.push(change(before.query, isLost ? "lost" : "stable", null, before));
  }

  return changes.sort((a, b) => a.query.localeCompare(b.query));
}

function trendFor(now: SnapshotQuery, before: SnapshotQuery): QueryTrend {
  if (before.impressions < MIN_VIEWS_FOR_TREND) return "stable";
  const positionChange = now.position - before.position;
  const viewsDropped = now.impressions < before.impressions * (1 - VIEWS_DROP_RATIO);
  if (positionChange >= POSITION_MOVE || viewsDropped) return "down";
  if (positionChange <= -POSITION_MOVE) return "up";
  return "stable";
}

function change(query: string, trend: QueryTrend, current: SnapshotQuery | null, previous: SnapshotQuery | null): QueryChange {
  return {
    query,
    trend,
    current,
    previous,
    positionChange: current && previous ? current.position - previous.position : null,
    impressionsChange: (current?.impressions ?? 0) - (previous?.impressions ?? 0),
    clicksChange: (current?.clicks ?? 0) - (previous?.clicks ?? 0),
  };
}

export type ChangeSummary = { up: number; down: number; new: number; lost: number };

export function summarizeChanges(changes: QueryChange[]): ChangeSummary {
  const summary: ChangeSummary = { up: 0, down: 0, new: 0, lost: 0 };
  for (const c of changes) {
    if (c.trend !== "stable") summary[c.trend] += 1;
  }
  return summary;
}
