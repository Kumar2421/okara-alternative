"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationMode, AutomationSettings } from "@/lib/domain/actions/automationSettings";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";

type Response = { settings: AutomationSettings };

/** The project's daily-automation setting (off by default), cached per project. */
export function useAutomation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.automation(projectId),
    queryFn: () => fetchJson<Response>("/api/agents/automation"),
    enabled: Boolean(projectId),
  });

  const save = useMutation({
    mutationFn: (mode: AutomationMode) =>
      fetchJson<Response>("/api/agents/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<Response>(qk.automation(projectId), data);
    },
  });

  return { mode: query.data?.settings.mode ?? "off", isLoading: query.isPending && Boolean(projectId), isError: query.isError, save };
}
