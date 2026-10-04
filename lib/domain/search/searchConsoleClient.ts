import { buildSnapshotPayload, snapshotRanges, type SearchSnapshotPayload } from "./searchSnapshot.ts";
import type { QueryRow } from "./types.ts";

/** Fetches Search Console rows for one date range; implementations hide how auth works. */
export type FetchSearchRows = (
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit?: number,
) => Promise<QueryRow[]>;

/** Platform mode: the caller already holds an access token decrypted from Vault. */
export async function fetchSearchAnalyticsWithToken(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 25000,
): Promise<QueryRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Search Console query failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return data.rows ?? [];
}

/** One Search Console snapshot: 5 parallel calls (4 query windows + query/page for the main window). */
export async function captureSearchSnapshot(
  fetchRows: FetchSearchRows,
  siteUrl: string,
  now: Date = new Date(),
): Promise<SearchSnapshotPayload> {
  const ranges = snapshotRanges(now);
  const [d7, d28, d90, prev28, d28Pages] = await Promise.all([
    fetchRows(siteUrl, ranges.d7.startDate, ranges.d7.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d28.startDate, ranges.d28.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d90.startDate, ranges.d90.endDate, ["query"]),
    fetchRows(siteUrl, ranges.prev28.startDate, ranges.prev28.endDate, ["query"]),
    fetchRows(siteUrl, ranges.d28.startDate, ranges.d28.endDate, ["query", "page"]),
  ]);
  return buildSnapshotPayload({ now, siteUrl, ranges, rows: { d7, d28, d90, prev28, d28Pages } });
}
