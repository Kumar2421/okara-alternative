"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/dashboard/Toast";

/** Governs whether creating a new project automatically triggers competitor
 * discovery (see project-store.tsx). On by default — when Tavily isn't
 * connected, discovery still runs using the CompetitorDiscoveryAgent's
 * context-only fallback (every candidate still gets verified by a real fetch
 * before being saved, so this is safe even without web search). */
export default function CompetitorDiscoveryToggle() {
  const { show } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const row = data.settings?.find((s) => s.key === "auto_discover_competitors");
        // Absent = enabled (default on), only an explicit "0" turns it off.
        setEnabled(row?.value !== "0");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "auto_discover_competitors", value: next ? "1" : "0" }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
      setEnabled(next);
      show(next ? "New projects will auto-discover competitors." : "Auto-discovery disabled — add competitors manually in the Context panel.");
    } catch {
      show("Failed to update this setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <div className="text-[13px] font-semibold text-gray-900">Auto-discover competitors</div>
        <div className="text-[12px] text-gray-500">
          When a new project is created, automatically find and add real competitors — web-search-grounded
          if Tavily is connected above, otherwise based on the crawled site and existing documents alone.
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={!loaded || busy}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-[#111111]" : "bg-gray-200"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
