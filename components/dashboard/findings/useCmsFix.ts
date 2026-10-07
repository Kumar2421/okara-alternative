"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";
import { findProviderForModel, useProviders } from "@/lib/providers-store";
import type { CmsChange } from "@/lib/domain/cms/cmsFixCatalog";
import type { CmsStatus } from "@/app/api/agents/cms/status/route";

export type { CmsStatus };

export type PreparedCmsFix =
  | { mode: "manual"; reason: string; recommendation: string }
  | {
      mode: "auto";
      cms: "wordpress" | "webflow";
      cmsLabel: string;
      label: string;
      item: { title: string; url: string };
      explanation: string;
      changes: CmsChange[];
      unsupported: { field: string; reason: string }[];
      ticket: string;
    };

export type AppliedCmsFix = { liveUrl: string; applied: string[]; note: string | null; summary: string; tracked: boolean; cmsLabel: string };

/** Which CMSs (WordPress, Webflow) are connected. Names only, never a credential. */
export function useCmsStatus(enabled = true) {
  return useQuery({
    queryKey: qk.cmsStatus(),
    queryFn: () => fetchJson<CmsStatus>("/api/agents/cms/status"),
    enabled,
    staleTime: 30_000,
  });
}

/** Prepare (preview only, nothing is written) and approve (writes to the CMS) for one finding. */
export function useCmsFix(findingId: string) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const { primaryModel } = useProviders();

  const prepare = useMutation({
    mutationFn: (cms: "wordpress" | "webflow") => {
      const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
      return fetchJson<PreparedCmsFix>("/api/agents/cms/fix/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, cms, model: primaryModel ?? undefined, providerId: providerId ?? undefined }),
      });
    },
  });

  const approve = useMutation({
    mutationFn: async (input: { ticket: string; changes: CmsChange[]; edited: boolean }) => {
      let ticket = input.ticket;
      if (input.edited) {
        // An edited preview needs a fresh ticket bound to the edit before it can be applied.
        const revised = await fetchJson<{ ticket: string }>("/api/agents/cms/fix/revise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingId, ticket, changes: input.changes }),
        });
        ticket = revised.ticket;
      }
      return fetchJson<AppliedCmsFix>("/api/agents/cms/fix/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, ticket, changes: input.changes }),
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.findingActions(project?.id, findingId) }),
        queryClient.invalidateQueries({ queryKey: qk.findings(project?.id) }),
      ]),
  });

  return { prepare, approve, hasModel: Boolean(primaryModel && findProviderForModel(primaryModel)) };
}
