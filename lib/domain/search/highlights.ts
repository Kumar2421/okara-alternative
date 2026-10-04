import type { OpportunityGroups, SearchOpportunity } from "./searchOpportunities.ts";

export const MAX_HIGHLIGHTS = 3;

/**
 * The few items worth a glance before opening the full list. Ordered by how
 * urgent they are for a non-expert: things getting worse first, then easy
 * snippet wins, then the closest-to-page-one searches, then new and lost.
 * Never repeats a query, and falls back to more "closest to page one" items
 * so a quiet month still shows something useful.
 */
export function pickHighlights(groups: OpportunityGroups, limit = MAX_HIGHLIGHTS): SearchOpportunity[] {
  const picked: SearchOpportunity[] = [];
  const seen = new Set<string>();

  const add = (item: SearchOpportunity | undefined) => {
    if (!item || seen.has(item.query) || picked.length >= limit) return;
    seen.add(item.query);
    picked.push(item);
  };

  add(groups.declining[0]);
  add(groups.ctr[0]);
  add(groups.ranking[0]);
  add(groups.newQueries[0]);
  add(groups.lostQueries[0]);
  for (const item of groups.ranking.slice(1)) add(item);
  for (const item of groups.ctr.slice(1)) add(item);

  return picked;
}
