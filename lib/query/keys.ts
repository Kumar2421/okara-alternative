/**
 * Query keys. Everything that belongs to a project starts with
 * ["project", projectId], so switching projects can never serve another
 * project's data, and a whole project's cache can be dropped or refreshed
 * with one prefix.
 */
const scope = (projectId: string | undefined) => ["project", projectId ?? "none"] as const;

export const qk = {
  project: scope,
  dashboardData: (projectId: string | undefined) => [...scope(projectId), "dashboard-data"] as const,
  audit: (projectId: string | undefined, url: string | undefined, version: number) =>
    [...scope(projectId), "audit", url ?? "", version] as const,
  links: (projectId: string | undefined) => [...scope(projectId), "links"] as const,
  geo: (projectId: string | undefined) => [...scope(projectId), "geo"] as const,
  siteCrawl: (projectId: string | undefined) => [...scope(projectId), "site-crawl"] as const,
  traffic: (projectId: string | undefined) => [...scope(projectId), "traffic"] as const,
  googleResources: (projectId: string | undefined) => [...scope(projectId), "google-resources"] as const,
  searchHistory: (projectId: string | undefined) => [...scope(projectId), "search-history"] as const,
  findings: (projectId: string | undefined) => [...scope(projectId), "findings"] as const,
  findingRecommendations: (projectId: string | undefined, findingId: string) =>
    [...scope(projectId), "findings", findingId, "recommendations"] as const,
  findingActions: (projectId: string | undefined, findingId: string) =>
    [...scope(projectId), "findings", findingId, "actions"] as const,
  searchOpportunities: (projectId: string | undefined) => [...scope(projectId), "search-opportunities"] as const,
};
