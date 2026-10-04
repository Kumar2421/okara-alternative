"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpportunityGroups } from "@/lib/domain/search/searchOpportunities";

/** Dispatched after a snapshot refresh so every search view reloads. */
export const SEARCH_REFRESHED_EVENT = "marlo:search-refreshed";

export type SearchOpportunitiesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; capturedAt: string; opportunities: OpportunityGroups };

type Response = { snapshot: { capturedAt: string } | null; opportunities?: OpportunityGroups };

/** Loads the grouped opportunities from the latest saved snapshot and reloads on refresh. */
export function useSearchOpportunities(): SearchOpportunitiesState {
  const [state, setState] = useState<SearchOpportunitiesState>({ status: "loading" });

  const load = useCallback(() => {
    fetch("/api/agents/analytics/search/opportunities")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((json: Response) => {
        if (!json.snapshot || !json.opportunities) setState({ status: "empty" });
        else setState({ status: "ready", capturedAt: json.snapshot.capturedAt, opportunities: json.opportunities });
      })
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SEARCH_REFRESHED_EVENT, load);
    return () => window.removeEventListener(SEARCH_REFRESHED_EVENT, load);
  }, [load]);

  return state;
}
