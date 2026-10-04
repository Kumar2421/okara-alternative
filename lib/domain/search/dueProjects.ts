export type SnapshotTarget = { projectId: string; userId: string };

/**
 * Projects that have Search Console connected but no snapshot for today yet.
 * Deduplicates repeated connections and keeps a stable order so a run that
 * stopped on its time budget resumes with the same remaining projects.
 */
export function selectDueProjects(connected: SnapshotTarget[], snapshottedToday: Set<string>): SnapshotTarget[] {
  const seen = new Set<string>();
  return connected
    .filter((target) => {
      if (snapshottedToday.has(target.projectId) || seen.has(target.projectId)) return false;
      seen.add(target.projectId);
      return true;
    })
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}
