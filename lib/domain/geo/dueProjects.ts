export type GeoTarget = { projectId: string; userId: string };

/** Start of the UTC week (Monday 00:00) containing `now`, as an ISO string. */
export function utcWeekStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString();
}

/**
 * Projects due for the weekly AI-visibility run: deduplicated, skipping any
 * that already have a run this week, ordered by OLDEST last run first (never
 * run = first). A run that stops on the time budget therefore cannot starve
 * the projects at the end of a fixed ordering; next time they come first.
 */
export function selectDueGeoProjects(connected: GeoTarget[], lastRunByProject: Map<string, string>, weekStartIso: string): GeoTarget[] {
  const seen = new Set<string>();
  const due = connected.filter((t) => {
    if (seen.has(t.projectId)) return false;
    seen.add(t.projectId);
    const last = lastRunByProject.get(t.projectId);
    return !last || last < weekStartIso;
  });
  return due.sort((a, b) => {
    const la = lastRunByProject.get(a.projectId) ?? "";
    const lb = lastRunByProject.get(b.projectId) ?? "";
    return la === lb ? a.projectId.localeCompare(b.projectId) : la < lb ? -1 : 1;
  });
}
