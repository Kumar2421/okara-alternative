/**
 * Convert search delta changes into plain-language events for the week.
 * No jargon, plain words (appeared/disappeared/improved/declined).
 */

import { compareWindows, type QueryChange } from "./searchDelta.ts";
import type { SnapshotWindow } from "./searchSnapshot.ts";

export type WeekEvent = {
  type: "appeared" | "disappeared" | "improved" | "declined";
  query: string;
  detail: string;
};

/**
 * Convert query changes into human-readable events.
 * @param changes Output from compareWindows()
 * @param limit Max events to return
 */
export function eventsFromChanges(changes: QueryChange[], limit: number = 5): WeekEvent[] {
  const events: WeekEvent[] = [];

  // 1. New searches
  for (const change of changes.filter((c) => c.trend === "new")) {
    const impressions = Math.round(change.current?.impressions ?? 0);
    events.push({
      type: "appeared",
      query: change.query,
      detail: `New search bringing ${impressions} views.`,
    });
  }

  // 2. Searches that disappeared
  for (const change of changes.filter((c) => c.trend === "lost")) {
    const impressions = Math.round(change.previous?.impressions ?? 0);
    events.push({
      type: "disappeared",
      query: change.query,
      detail: `Was getting ${impressions} views, now gone.`,
    });
  }

  // 3. Improved rankings
  for (const change of changes.filter((c) => c.trend === "up")) {
    const positionChange = Math.abs(Math.round(change.positionChange ?? 0));
    events.push({
      type: "improved",
      query: change.query,
      detail: `Moved up ${positionChange} position${positionChange !== 1 ? "s" : ""}.`,
    });
  }

  // 4. Declining rankings or impressions
  for (const change of changes.filter((c) => c.trend === "down")) {
    const positionChange = Math.abs(Math.round(change.positionChange ?? 0));
    const impressionDrop = Math.abs(change.impressionsChange);
    if (positionChange > 0) {
      events.push({
        type: "declined",
        query: change.query,
        detail: `Dropped ${positionChange} position${positionChange !== 1 ? "s" : ""}.`,
      });
    } else if (impressionDrop > 0) {
      events.push({
        type: "declined",
        query: change.query,
        detail: `Lost ${Math.round(impressionDrop)} views.`,
      });
    }
  }

  return events.slice(0, limit);
}

/**
 * Compare two snapshot windows and return plain-language events.
 * @param current Current snapshot window
 * @param previous Previous snapshot window (for real comparison)
 * @param limit Max events to return
 */
export function weekChanges(current: SnapshotWindow | null, previous: SnapshotWindow | null, limit: number = 5): WeekEvent[] {
  if (!current || !previous) return [];
  const changes = compareWindows(current.queries, previous.queries);
  return eventsFromChanges(changes, limit);
}
