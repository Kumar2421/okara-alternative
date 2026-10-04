"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldRetry } from "./retry";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Fresh for 30s: switching tabs or panels reuses data instead of refetching,
        // but anything older revalidates in the background while the old value stays visible.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/** One shared client for the whole app, so every panel reads and invalidates the same cache. */
export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
