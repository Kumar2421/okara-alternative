"use client";

import { useMemo } from "react";
import { useDashboardData, type DashboardData } from "./dashboard-data";

export type ContextDocument = {
  id?: string;
  doc_type?: string;
  content?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ContextCompetitor = {
  id: string;
  url: string;
  created_at?: string;
  [key: string]: unknown;
};

export type ProjectContext = {
  project: DashboardData["project"];
  projectId: string;
  documents: ContextDocument[];
  competitors: ContextCompetitor[];
};

function rowsFor<T extends Record<string, unknown>>(data: DashboardData | null, dataset: "project_documents" | "project_competitors"): T[] {
  return (data?.data[dataset] ?? []) as T[];
}

export function selectProjectContext(data: DashboardData | null): ProjectContext | null {
  if (!data) return null;

  return {
    project: data.project,
    projectId: data.projectId,
    documents: rowsFor<ContextDocument>(data, "project_documents"),
    competitors: rowsFor<ContextCompetitor>(data, "project_competitors").filter(
      (competitor): competitor is ContextCompetitor => typeof competitor.id === "string" && typeof competitor.url === "string",
    ),
  };
}

export function useProjectContext() {
  const dashboard = useDashboardData();
  const context = useMemo(() => selectProjectContext(dashboard.data), [dashboard.data]);

  return {
    ...dashboard,
    context,
    documents: context?.documents ?? [],
    competitors: context?.competitors ?? [],
  };
}
