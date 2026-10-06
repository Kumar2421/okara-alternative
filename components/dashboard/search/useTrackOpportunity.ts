"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Finding } from "@/lib/domain/findings/findingTypes";
import { normalizeQuery } from "@/lib/domain/search/searchIntent";
import type { SearchOpportunity } from "@/lib/domain/search/searchOpportunities";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

const keyOf = (item: Pick<SearchOpportunity, "type" | "query">) => `${item.type}:${normalizeQuery(item.query)}`;

/**
 * Which search opportunities are already tracked as findings, and a way to
 * track one. Shares the findings cache, so a new finding appears in the
 * Findings tab straight away.
 */
export function useTrackOpportunity() {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();

  const findings = useQuery({
    queryKey: qk.findings(projectId),
    queryFn: async () => (await fetchJson<{ findings?: Finding[] }>("/api/agents/analytics/findings")).findings ?? [],
    enabled: Boolean(project),
  });

  const tracked = new Set((findings.data ?? []).filter((f) => f.source === "search-console").map((f) => f.entityId));

  const track = useMutation({
    mutationFn: (item: SearchOpportunity) =>
      fetchJson<{ finding: Finding }>("/api/agents/analytics/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityType: item.type, query: item.query }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.findings(projectId) }),
  });

  return {
    isTracked: (item: SearchOpportunity) => tracked.has(keyOf(item)),
    track: (item: SearchOpportunity) => track.mutate(item),
    pendingKey: track.isPending && track.variables ? keyOf(track.variables) : null,
    keyOf,
    error: track.error instanceof Error ? track.error.message : null,
  };
}

export type OpportunityTracking = ReturnType<typeof useTrackOpportunity>;
