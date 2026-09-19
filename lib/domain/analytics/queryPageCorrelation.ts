export type RankingPage = {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type QueryOpportunityLike = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  score: number;
};

type QueryPageRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type QueryOpportunityWithPages = QueryOpportunityLike & {
  rankingPages: RankingPage[];
};

const MAX_RANKING_PAGES = 3;

export function attachRankingPages(
  opportunities: QueryOpportunityLike[],
  rows: QueryPageRow[]
): QueryOpportunityWithPages[] {
  const pagesByQuery = new Map<string, Map<string, RankingPage>>();

  for (const row of rows) {
    const query = row.keys[0]?.trim() ?? "";
    const url = row.keys[1]?.trim() ?? "";
    if (!query || !url || row.impressions <= 0) continue;

    let pages = pagesByQuery.get(query);
    if (!pages) {
      pages = new Map();
      pagesByQuery.set(query, pages);
    }

    const existing = pages.get(url);
    if (!existing) {
      pages.set(url, {
        url,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
      continue;
    }

    const impressions = existing.impressions + row.impressions;
    const clicks = existing.clicks + row.clicks;
    const weightedPosition =
      (existing.position * existing.impressions + row.position * row.impressions) / impressions;

    pages.set(url, {
      url,
      clicks,
      impressions,
      ctr: clicks / impressions,
      position: weightedPosition,
    });
  }

  return opportunities.map((opportunity) => ({
    ...opportunity,
    rankingPages: [...(pagesByQuery.get(opportunity.query)?.values() ?? [])]
      .sort(
        (a, b) =>
          b.impressions - a.impressions ||
          b.clicks - a.clicks ||
          a.position - b.position ||
          a.url.localeCompare(b.url)
      )
      .slice(0, MAX_RANKING_PAGES),
  }));
}
