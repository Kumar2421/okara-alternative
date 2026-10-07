/** Pure: turns a week of activity into the weekly digest, or null when there is nothing worth an email. */

type WindowLike = { queries: Array<{ clicks: number; impressions: number; position: number }> };
/** The slice of a saved search snapshot the digest needs (the 7-day window). */
export type SnapshotLike = { snapshotDate: string; payload: { windows: { d7: WindowLike } } };

export type MeasuredFix = {
  actionTitle: string;
  status: "improved" | "unchanged" | "regressed";
  confidence: "early" | "solid" | null;
  /** The outcome's own plain-language headline, already cautiously worded. */
  headline: string;
};

export type ProjectActivity = {
  projectId: string;
  projectName: string;
  /** Verdicts that became solid during this period. */
  newOutcomes: MeasuredFix[];
  /** Changes the user marked as made during this period. */
  fixesMade: Array<{ title: string }>;
  latest: SnapshotLike | null;
  /** The snapshot closest to 7 days before `latest`. */
  weekAgo: SnapshotLike | null;
  approvalsWaiting: number;
};

export type Movement = {
  clicks: { before: number; after: number };
  impressions: { before: number; after: number };
  /** Average position, weighted by views. Lower is better. */
  position: { before: number; after: number } | null;
};

export type DigestProject = {
  projectId: string;
  projectName: string;
  outcomes: MeasuredFix[];
  fixesMade: string[];
  movement: Movement | null;
  approvalsWaiting: number;
};

export type Digest = {
  projects: DigestProject[];
  /** One plain line for the in-app list and the email preview text. */
  summary: string;
};

/** Smallest week-over-week change worth mentioning, so a quiet site does not get a "movement" paragraph of noise. */
export const MIN_CLICKS_CHANGE = 5;
export const MIN_IMPRESSIONS_CHANGE = 0.1;

function totals(window: WindowLike): { clicks: number; impressions: number; position: number | null } {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const q of window.queries) {
    clicks += q.clicks;
    impressions += q.impressions;
    weighted += q.position * q.impressions;
  }
  return { clicks, impressions, position: impressions > 0 ? weighted / impressions : null };
}

/** Last 7 days vs the 7 days before, from two snapshots about a week apart. Null when there is no real comparison or no meaningful change. */
export function movementBetween(latest: SnapshotLike | null, weekAgo: SnapshotLike | null): Movement | null {
  if (!latest || !weekAgo || latest.snapshotDate <= weekAgo.snapshotDate) return null;
  const a = totals(weekAgo.payload.windows.d7);
  const b = totals(latest.payload.windows.d7);
  if (a.clicks + a.impressions === 0 && b.clicks + b.impressions === 0) return null;
  const clicksMoved = Math.abs(b.clicks - a.clicks) >= MIN_CLICKS_CHANGE;
  const impressionsMoved = a.impressions > 0 ? Math.abs(b.impressions - a.impressions) / a.impressions >= MIN_IMPRESSIONS_CHANGE : b.impressions > 0;
  if (!clicksMoved && !impressionsMoved) return null;
  return {
    clicks: { before: Math.round(a.clicks), after: Math.round(b.clicks) },
    impressions: { before: Math.round(a.impressions), after: Math.round(b.impressions) },
    position: a.position !== null && b.position !== null ? { before: a.position, after: b.position } : null,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Build the digest across a user's projects. Returns null when nothing
 * happened anywhere, so an idle week sends no email at all.
 */
export function buildDigest(activity: ProjectActivity[]): Digest | null {
  const projects: DigestProject[] = [];
  for (const p of activity) {
    const entry: DigestProject = {
      projectId: p.projectId,
      projectName: p.projectName,
      outcomes: p.newOutcomes,
      fixesMade: p.fixesMade.map((f) => f.title),
      movement: movementBetween(p.latest, p.weekAgo),
      approvalsWaiting: p.approvalsWaiting,
    };
    if (entry.outcomes.length || entry.fixesMade.length || entry.movement || entry.approvalsWaiting > 0) projects.push(entry);
  }
  if (projects.length === 0) return null;

  const outcomes = projects.reduce((n, p) => n + p.outcomes.length, 0);
  const fixes = projects.reduce((n, p) => n + p.fixesMade.length, 0);
  const waiting = projects.reduce((n, p) => n + p.approvalsWaiting, 0);
  const bits: string[] = [];
  if (outcomes) bits.push(`${plural(outcomes, "fix", "fixes")} measured`);
  if (fixes) bits.push(`${plural(fixes, "change", "changes")} made`);
  if (waiting) bits.push(`${waiting} waiting for your review`);
  if (bits.length === 0) bits.push("search traffic moved");
  const [first, ...rest] = bits;
  return { projects, summary: [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", ") + "." };
}

/** Plain-language caution shown wherever a measured result appears. */
export const OUTCOME_CAVEAT =
  "Search results move for many reasons. A measured change is a signal worth noting, not proof the fix caused it.";
