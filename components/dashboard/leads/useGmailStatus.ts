"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";
import { qk } from "@/lib/query/keys";

export type GmailStatus = {
  connected: boolean;
  email?: string | null;
  canSend?: boolean;
  canRead?: boolean;
  mode?: "platform" | "self-host";
};

/** Whether Gmail is connected for outreach, and what the connection is allowed to do. Same answer in both modes. */
export function useGmailStatus() {
  const query = useQuery({
    queryKey: qk.gmailStatus(),
    queryFn: () => fetchJson<GmailStatus>("/api/auth/gmail/status"),
    staleTime: 60_000,
  });

  const status = query.data;
  const connected = Boolean(status?.connected);
  return {
    isLoading: query.isPending,
    isError: query.isError,
    connected,
    email: status?.email ?? null,
    // Unknown capabilities are treated as allowed; Google's own answer decides at send time.
    canSend: connected && status?.canSend !== false,
    canRead: connected && status?.canRead !== false,
  };
}
