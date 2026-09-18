export type QueryOpportunity = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  score: number;
};

const MIN_POSITION = 4;
const MAX_POSITION = 15;
const MIN_IMPRESSIONS = 100;
const MAX_OPPORTUNITIES = 8;

/**
 * Finds queries that already have meaningful search visibility but rank below
 * the first few results. The score is only a prioritization heuristic; it is
 * not a forecast of additional clicks.
 *
 * Higher impressions increase the opportunity, lower CTR increases the
 * opportunity, and positions closer to the top of page one receive more weight.
 */
export function findQueryOpportunities(
  rows: Array<{
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>
): QueryOpportunity[] {
  return rows
    .map((row) => ({
      query: row.keys[0]?.trim() ?? "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }))
    .filter(
      (row) =>
        row.query.length > 0 &&
        row.position >= MIN_POSITION &&
        row.position <= MAX_POSITION &&
        row.impressions >= MIN_IMPRESSIONS
    )
    .map((row) => {
      const positionWeight =
        (MAX_POSITION + 1 - row.position) / (MAX_POSITION + 1 - MIN_POSITION);
      const score = row.impressions * (1 - Math.min(Math.max(row.ctr, 0), 1)) * positionWeight;

      return { ...row, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.impressions - a.impressions ||
        a.position - b.position ||
        a.query.localeCompare(b.query)
    )
    .slice(0, MAX_OPPORTUNITIES);
}
