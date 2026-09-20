"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const DASHBOARD_DATASETS = [
  "project_documents",
  "project_competitors",
  "seo_audits",
  "link_checks",
  "geo_checks",
  "site_crawls",
  "traffic_checks",
  "findings",
  "code_fixes",
  "leads",
] as const;

export type DashboardDataset = (typeof DASHBOARD_DATASETS)[number];
export type DashboardRows = Record<DashboardDataset, Record<string, unknown>[]>;

export type DashboardData = {
  project: Record<string, unknown>;
  projectId: string;
  data: DashboardRows;
};

type DashboardDataState = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DashboardDataContext = createContext<DashboardDataState | null>(null);

export async function fetchDashboardData(projectId?: string | null): Promise<DashboardData> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`/api/project/data${query}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<DashboardData>;

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load dashboard data");
  }

  if (!payload.project || !payload.projectId || !payload.data) {
    throw new Error("Dashboard data response is incomplete");
  }

  return payload as DashboardData;
}

export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDashboardData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchDashboardData()
      .then((nextData) => {
        if (!cancelled) setData(nextData);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load dashboard data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ data, loading, error, refresh }), [data, loading, error, refresh]);
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error("useDashboardData must be used within DashboardDataProvider");
  return context;
}
