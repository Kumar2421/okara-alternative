import { attachRankingPages, type RankingPage } from "../analytics/queryPageCorrelation.ts";
import type { QueryRow } from "./types.ts";

/** Google Search Console data lags about three days. */
const GSC_LAG_DAYS = 3;

/** The 28-day window is the main one; the others are kept leaner. */
export const TOP_QUERIES_MAIN = 500;
export const TOP_QUERIES_OTHER = 200;

export const SNAPSHOT_RETENTION_DAYS = 120;

export type SnapshotQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SnapshotWindow = {
  startDate: string;
  endDate: string;
  queries: SnapshotQuery[];
};

export type SearchSnapshotPayload = {
  version: 1;
  capturedAt: string;
  siteUrl: string;
  windows: {
    d7: SnapshotWindow;
    /** Main window; each query also carries its top ranking pages. */
    d28: SnapshotWindow & { queries: Array<SnapshotQuery & { rankingPages: RankingPage[] }> };
    d90: SnapshotWindow;
    /** The 28 days before `d28`, so trends exist from the very first snapshot. */
    prev28: SnapshotWindow;
  };
};

export type WindowRange = { startDate: string; endDate: string };

export type SnapshotRanges = { d7: WindowRange; d28: WindowRange; d90: WindowRange; prev28: WindowRange };

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Date ranges (UTC, inclusive) for every window, ending at the freshest day GSC has. */
export function snapshotRanges(now: Date): SnapshotRanges {
  const end = addDays(now, -GSC_LAG_DAYS);
  const range = (endDate: Date, length: number): WindowRange => ({
    startDate: isoDate(addDays(endDate, -(length - 1))),
    endDate: isoDate(endDate),
  });
  return {
    d7: range(end, 7),
    d28: range(end, 28),
    d90: range(end, 90),
    prev28: range(addDays(end, -28), 28),
  };
}

function toWindow(range: WindowRange, rows: QueryRow[], limit: number): SnapshotWindow {
  const queries = rows
    .map((row) => ({
      query: row.keys[0]?.trim() ?? "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }))
    .filter((q) => q.query.length > 0 && q.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query))
    .slice(0, limit);
  return { ...range, queries };
}

export type SnapshotInput = {
  now: Date;
  siteUrl: string;
  ranges: SnapshotRanges;
  rows: { d7: QueryRow[]; d28: QueryRow[]; d90: QueryRow[]; prev28: QueryRow[]; d28Pages: QueryRow[] };
};

/** Pure: shrink raw GSC rows into the compact payload that gets stored. */
export function buildSnapshotPayload({ now, siteUrl, ranges, rows }: SnapshotInput): SearchSnapshotPayload {
  const d28 = toWindow(ranges.d28, rows.d28, TOP_QUERIES_MAIN);
  const withPages = attachRankingPages(
    d28.queries.map((q) => ({ ...q, score: 0 })),
    rows.d28Pages,
  ).map(({ query, clicks, impressions, ctr, position, rankingPages }) => ({
    query,
    clicks,
    impressions,
    ctr,
    position,
    rankingPages,
  }));

  return {
    version: 1,
    capturedAt: now.toISOString(),
    siteUrl,
    windows: {
      d7: toWindow(ranges.d7, rows.d7, TOP_QUERIES_OTHER),
      d28: { ...d28, queries: withPages },
      d90: toWindow(ranges.d90, rows.d90, TOP_QUERIES_OTHER),
      prev28: toWindow(ranges.prev28, rows.prev28, TOP_QUERIES_OTHER),
    },
  };
}

/** Oldest snapshot date to keep, for pruning. */
export function retentionCutoff(now: Date): string {
  return isoDate(addDays(now, -SNAPSHOT_RETENTION_DAYS));
}
