"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "./intentLabels";
import { SEARCH_REFRESHED_EVENT } from "./useSearchOpportunities";

type Meta = { capturedAt: string; days: number } | null;

/** Shows how fresh the saved search history is and lets the user capture a new snapshot now. */
export default function SearchHistoryBar() {
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/agents/analytics/search/refresh")
      .then((r) => (r.ok ? r.json() : { snapshot: null }))
      .then((data) => setMeta(data.snapshot ?? null))
      .catch(() => setMeta(null));
  }, []);
  useEffect(load, [load]);

  const refresh = () => {
    setBusy(true);
    setError(null);
    fetch("/api/agents/analytics/search/refresh", { method: "POST" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(data.error ?? "Could not refresh search data.");
        } else {
          load();
          window.dispatchEvent(new Event(SEARCH_REFRESHED_EVENT));
        }
      })
      .catch(() => setError("Could not refresh search data."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-3 text-[11px] text-gray-500">
      <span>
        {meta === undefined
          ? "Checking saved history…"
          : meta
            ? `Updated ${timeAgo(meta.capturedAt)} · ${meta.days} ${meta.days === 1 ? "day" : "days"} of history`
            : "No search history yet. Refresh to start tracking changes over time."}
        {error && <span className="ml-2 text-amber-600">⚠ {error}</span>}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
    </div>
  );
}
