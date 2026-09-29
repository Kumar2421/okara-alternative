"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { providers as PROVIDER_DEFS } from "./mock-providers";
import { createClient } from "@/utils/supabase/client";
import { FEATURES } from "./features";

type ConnectionState = {
  connected: boolean;
  // Kept only for compatibility with existing consumers. Raw provider keys
  // are never persisted to localStorage; the server is the source of truth.
  apiKey: string;
  baseUrl?: string;
};

type ProvidersState = Record<string, ConnectionState>;

type Ctx = {
  state: ProvidersState;
  primaryModel: string | null;
  loading: boolean;
  platformProviders: string[];
  setPrimaryModel: (model: string) => void;
  connect: (providerId: string, apiKey: string, baseUrl?: string) => Promise<void>;
  disconnect: (providerId: string) => Promise<void>;
  connectedModels: { providerId: string; providerName: string; model: string }[];
};

const ProvidersCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "okara.providers.v2";

export function useProviders() {
  const ctx = useContext(ProvidersCtx);
  if (!ctx) throw new Error("useProviders must be used within ProvidersProvider");
  return ctx;
}

function cacheKey(userId: string | null) {
  return `${STORAGE_KEY}:${userId ?? "anonymous"}`;
}

export default function ProvidersProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProvidersState>({});
  const [primaryModel, setPrimaryModelState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformProviders, setPlatformProviders] = useState<string[]>([]);
  const userIdRef = useRef<string | null>(null);

  const persistCache = useCallback(
    (next: ProvidersState, primary: string | null, id = userIdRef.current) => {
      try {
        localStorage.setItem(cacheKey(id), JSON.stringify({ state: next, primaryModel: primary }));
      } catch {
        // storage unavailable, keep in-memory only
      }
    },
    []
  );

  const clearSessionState = useCallback((id: string | null) => {
    userIdRef.current = id;
    setState({});
    setPrimaryModelState(null);
    setPlatformProviders([]);
    try {
      localStorage.removeItem(cacheKey(null));
      if (id) localStorage.removeItem(cacheKey(id));
    } catch {
      // storage unavailable
    }
  }, []);

  const loadProviders = useCallback(
    async (id: string | null) => {
      if (FEATURES.PLATFORM_MODE && !id) {
        clearSessionState(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const raw = localStorage.getItem(cacheKey(id));
        if (raw) {
          const parsed = JSON.parse(raw);
          setState(parsed.state || {});
          setPrimaryModelState(parsed.primaryModel || null);
        }
      } catch {
        // ignore corrupt cache
      }

      try {
        const response = await fetch("/api/providers", { cache: "no-store" });
        if (response.status === 401 && FEATURES.PLATFORM_MODE) {
          clearSessionState(null);
          return;
        }
        if (!response.ok) throw new Error("Failed to load providers");

        const data: {
          connections: { providerId: string; keyPreview: string; baseUrl?: string }[];
          primaryModel: string | null;
          platformProviders?: string[];
        } = await response.json();

        const next: ProvidersState = {};
        for (const connection of data.connections) {
          next[connection.providerId] = {
            connected: true,
            // keyPreview is display metadata only. Never persist the raw key.
            apiKey: "",
            baseUrl: connection.baseUrl,
          };
        }

        setState(next);
        setPrimaryModelState(data.primaryModel);
        setPlatformProviders(data.platformProviders ?? []);
        persistCache(next, data.primaryModel, id);
      } catch {
        // Keep the session-scoped cache if the backend is temporarily unavailable.
      } finally {
        setLoading(false);
      }
    },
    [clearSessionState, persistCache]
  );

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    // Resolve the current browser session before loading any user-scoped data.
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const id = data.user?.id ?? null;
      userIdRef.current = id;
      void loadProviders(id);
    });

    // Keep client state aligned with sign-in, sign-out, and token refreshes.
    // Supabase persists/refreshes the session cookie; this subscription makes
    // the app react immediately when that session changes.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const id = session?.user?.id ?? null;

      if (event === "SIGNED_OUT") {
        clearSessionState(null);
        setLoading(false);
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (id !== userIdRef.current) {
          userIdRef.current = id;
          void loadProviders(id);
        }
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [clearSessionState, loadProviders]);

  const connect = useCallback(
    async (providerId: string, apiKey: string, baseUrl?: string) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, apiKey, baseUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to connect");

      setState((prev) => {
        const next = { ...prev, [providerId]: { connected: true, apiKey: "", baseUrl } };
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
        // local state remains usable; the next backend reconciliation restores truth
      });
    },
    [persistCache, state]
  );

  const connectedModels = PROVIDER_DEFS.filter(
    (p) => state[p.id]?.connected || platformProviders.includes(p.id)
  ).flatMap((p) => p.models.map((m) => ({ providerId: p.id, providerName: p.name, model: m })));

  return (
    <ProvidersCtx.Provider
      value={{ state, primaryModel, loading, platformProviders, setPrimaryModel, connect, disconnect, connectedModels }}
    >
      {children}
    </ProvidersCtx.Provider>
  );
}

export function findProviderForModel(model: string): string | null {
  const provider = PROVIDER_DEFS.find((p) => p.models.includes(model));
  return provider?.id ?? null;
}
