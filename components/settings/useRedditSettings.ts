"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emptyRedditSettings, type RedditSettings } from "@/lib/domain/reddit/redditSettings";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";
import { useProject } from "@/lib/project-store";

type Response = { settings: RedditSettings };

/** The project's saved Reddit settings. `save` updates optimistically and rolls back on failure. */
export function useRedditSettings() {
  const { project } = useProject();
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const key = qk.redditSettings(projectId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchJson<Response>("/api/agents/reddit/settings"),
    enabled: Boolean(project),
  });

  const save = useMutation({
    mutationFn: (settings: RedditSettings) =>
      fetchJson<Response>("/api/agents/reddit/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      }),
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Response>(key);
      queryClient.setQueryData<Response>(key, { settings });
      return { previous };
    },
    onError: (_err, _settings, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSuccess: ({ settings }) => {
      queryClient.setQueryData<Response>(key, { settings });
    },
  });

  return {
    isLoading: query.isPending && Boolean(project),
    isError: query.isError,
    settings: query.data?.settings ?? emptyRedditSettings(),
    save,
  };
}
