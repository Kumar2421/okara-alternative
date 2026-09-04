"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { providers as PROVIDER_DEFS } from "./mock-providers";

type ConnectionState = {
  connected: boolean;
  apiKey: string; // client-side cache only; real value never round-trips from the server after connect()
  baseUrl?: string;
};

type ProvidersState = Record<string, ConnectionState>;

type Ctx = {
  state: ProvidersState;
  primaryModel: string | null;
  loading: boolean;
  setPrimaryModel: (model: string) => void;
  connect: (providerId: string, apiKey: string, baseUrl?: string) => Promise<void>;
  disconnect: (providerId: string) => Promise<void>;
  connectedModels: { providerId: string; providerName: string; model: string }[];
};

const ProvidersCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "okara.providers.v1"; // fast-paint cache only; /api/providers is the source of truth

export function useProviders() {
  const ctx = useContext(ProvidersCtx);
  if (!ctx) throw new Error("useProviders must be used within ProvidersProvider");
  return ctx;
}

export default function ProvidersProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProvidersState>({});
  const [primaryModel, setPrimaryModelState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const persistCache = useCallback((next: ProvidersState, primary: string | null) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: next, primaryModel: primary }));
    } catch {
      // storage unavailable, keep in-memory only
    }
  }, []);

  useEffect(() => {
    // paint instantly from cache, then reconcile with the real backend
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState(parsed.state || {});
        setPrimaryModelState(parsed.primaryModel || null);
      }
    } catch {
      // ignore corrupt cache
    }

    fetch("/api/providers")
      .then((r) => r.json())
      .then(
        (data: {
          connections: { providerId: string; keyPreview: string; baseUrl?: string }[];
          primaryModel: string | null;
        }) => {
          const next: ProvidersState = {};
          for (const c of data.connections) {
            // keyPreview stands in for the real key client-side (server never returns it raw)
            next[c.providerId] = { connected: true, apiKey: c.keyPreview, baseUrl: c.baseUrl };
          }
          setState(next);
          setPrimaryModelState(data.primaryModel);
          persistCache(next, data.primaryModel);
        }
      )
      .catch(() => {
        // backend unreachable — keep whatever the cache had, chat will surface the real error on send
      })
      .finally(() => setLoading(false));
  }, [persistCache]);

  const connect = useCallback(
    async (providerId: string, apiKey: string, baseUrl?: string) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, apiKey, baseUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to connect");

      setState((prev) => {
        const next = { ...prev, [providerId]: { connected: true, apiKey, baseUrl } };
        persistCache(next, primaryModel);
        return next;
      });
    },
    [persistCache, primaryModel]
  );

  const disconnect = useCallback(
    async (providerId: string) => {
      const res = await fetch(`/api/providers?providerId=${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to disconnect");

      setState((prev) => {
        const next = { ...prev, [providerId]: { connected: false, apiKey: "" } };
        persistCache(next, primaryModel);
        return next;
      });
    },
    [persistCache, primaryModel]
  );

  const setPrimaryModel = useCallback(
    (model: string) => {
      setPrimaryModelState(model);
      persistCache(state, model);
      fetch("/api/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryModel: model }),
      }).catch(() => {
        // best-effort; local state already updated, next reconcile will catch drift
      });
    },
    [persistCache, state]
  );

  const connectedModels = PROVIDER_DEFS.filter((p) => state[p.id]?.connected).flatMap((p) =>
    p.models.map((m) => ({ providerId: p.id, providerName: p.name, model: m }))
  );

  return (
    <ProvidersCtx.Provider
      value={{ state, primaryModel, loading, setPrimaryModel, connect, disconnect, connectedModels }}
    >
      {children}
    </ProvidersCtx.Provider>
  );
}

export function findProviderForModel(model: string): string | null {
  const provider = PROVIDER_DEFS.find((p) => p.models.includes(model));
  return provider?.id ?? null;
}
