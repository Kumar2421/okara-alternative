"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { useProject } from "@/lib/project-store";

type Resource = { resourceId: string; resourceName: string; selected: boolean };
type IntegrationResources = {
  integrationType: "google-search-console" | "google-analytics";
  integrationId: string | null;
  resources: Resource[];
};

export default function GoogleAnalyticsCard() {
  const { show } = useToast();
  const searchParams = useSearchParams();
  const { project } = useProject();
  const [envActive, setEnvActive] = useState({ GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
  const [resources, setResources] = useState<IntegrationResources[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [envRes, resourceRes] = await Promise.all([
        fetch("/api/settings/env"),
        fetch("/api/project/integrations/google/resources"),
      ]);
      const envData = await envRes.json();
      const resourceData = await resourceRes.json();
      setEnvActive(envData.active ?? { GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
      setResources(resourceData.integrations ?? []);
    } catch {
      // Keep the card usable if the backend is temporarily unavailable.
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    const error = searchParams.get("ga_error");
    if (error) show(`Google Analytics connect failed: ${error}`);
  }, [searchParams, show]);

  useEffect(() => {
    if (project) load();
    else setLoaded(true);
  }, [project?.id]);

  async function selectResource(integrationType: IntegrationResources["integrationType"], resourceId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/project/integrations/google/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationType, resourceId }),
      });
      if (!res.ok) throw new Error();
      await load();
      show("Google resource selected for this project.");
    } catch {
      show("Failed to select Google resource.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/google-analytics/disconnect", { method: "POST" });
      if (!res.ok) throw new Error();
      await load();
      show("Google Analytics / Search Console disconnected from this project.");
    } catch {
      show("Failed to disconnect Google.");
    } finally {
      setBusy(false);
    }
  }

  const clientCredsActive = envActive.GMAIL_CLIENT_ID && envActive.GMAIL_CLIENT_SECRET;
  const gsc = resources.find((r) => r.integrationType === "google-search-console");
  const ga4 = resources.find((r) => r.integrationType === "google-analytics");
  const connected = Boolean(gsc?.integrationId || ga4?.integrationId);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 -space-x-1.5">
            <BrandIcon id="google-analytics" color="#f9ab00" fallback="A" className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-bold text-white ring-2 ring-white" size={15} />
            <BrandIcon id="search-console" color="#458cf5" fallback="S" className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-bold text-white ring-2 ring-white" size={15} />
          </span>
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              Google Analytics &amp; Search Console
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Powers the Traffic tab for the currently selected project.
            </div>
          </div>
        </div>
      </div>

      {!project ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          Select or create a project before connecting Google.
        </div>
      ) : !loaded ? null : !clientCredsActive ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Set up the Gmail OAuth Client ID/Secret above first — this reuses the same client.
        </div>
      ) : connected ? (
        <div className="space-y-3">
          {gsc?.resources.length ? (
            <ResourcePicker title="Search Console site" integrationType="google-search-console" resources={gsc.resources} disabled={busy} onSelect={selectResource} />
          ) : (
            <div className="text-[11px] text-amber-600">No Search Console properties were found on this Google account.</div>
          )}
          {ga4?.resources.length ? (
            <ResourcePicker title="GA4 property" integrationType="google-analytics" resources={ga4.resources} disabled={busy} onSelect={selectResource} />
          ) : (
            <div className="text-[11px] text-amber-600">No GA4 properties were found on this Google account.</div>
          )}
          <button onClick={handleDisconnect} disabled={busy} className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50">
            Disconnect Google from this project
          </button>
        </div>
      ) : (
        <a
          href="/api/auth/google-analytics/connect"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black"
        >
          Connect Google Analytics
        </a>
      )}
    </div>
  );
}

function ResourcePicker({
  title,
  integrationType,
  resources,
  disabled,
  onSelect,
}: {
  title: string;
  integrationType: IntegrationResources["integrationType"];
  resources: Resource[];
  disabled: boolean;
  onSelect: (type: IntegrationResources["integrationType"], resourceId: string) => Promise<void>;
}) {
  return (
    <label className="block text-[11px] text-gray-500">
      <span className="mb-1 block">{title}</span>
      <select
        value={resources.find((resource) => resource.selected)?.resourceId ?? ""}
        disabled={disabled}
        onChange={(e) => onSelect(integrationType, e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[12px] text-gray-700 disabled:opacity-50"
      >
        {resources.map((resource) => (
          <option key={resource.resourceId} value={resource.resourceId}>
            {resource.resourceName}
          </option>
        ))}
      </select>
    </label>
  );
}
