"use client";

import { useEffect, useState } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";

/** Real GA4 + Search Console OAuth — reuses the same GMAIL_CLIENT_ID/SECRET
 * app config as the Gmail card (one Google Cloud OAuth client, separate
 * consent flow/scopes/token set). Mirrors GmailCard.tsx's honesty pattern:
 * never implies "connected" until settings actually confirm it. */
export default function GoogleAnalyticsCard() {
  const { show } = useToast();
  const searchParams = useSearchParams();

  const [envActive, setEnvActive] = useState({ GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const error = searchParams.get("ga_error");
    if (error) show(`Google Analytics connect failed: ${error}`);
  }, [searchParams, show]);

  useEffect(() => {
    Promise.all([fetch("/api/settings/env").then((r) => r.json()), fetch("/api/settings").then((r) => r.json())])
      .then(([envData, settingsData]) => {
        setEnvActive(envData.active ?? { GMAIL_CLIENT_ID: false, GMAIL_CLIENT_SECRET: false });
        const find = (key: string) => settingsData.settings?.find((s: { key: string; value: string }) => s.key === key)?.value || null;
        setConnectedEmail(find("ga_email"));
        setSiteUrl(find("gsc_site_url"));
        setPropertyName(find("ga_property_name"));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/auth/google-analytics/disconnect", { method: "POST" });
      setConnectedEmail(null);
      setSiteUrl(null);
      setPropertyName(null);
      show("Google Analytics / Search Console disconnected.");
    } catch {
      show("Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  const clientCredsActive = envActive.GMAIL_CLIENT_ID && envActive.GMAIL_CLIENT_SECRET;

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
              {connectedEmail && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Powers the Traffic tab — real search clicks, rankings and top queries. Uses the same
              OAuth client as Gmail, above.
            </div>
          </div>
        </div>
      </div>

      {!loaded ? null : !clientCredsActive ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Set up the Gmail OAuth Client ID/Secret above first — this reuses the same client.
        </div>
      ) : connectedEmail ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            <span>{connectedEmail}</span>
            <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
              Disconnect
            </button>
          </div>
          <div className="text-[11px] text-gray-500">
            Search Console site: {siteUrl ? <span className="font-medium text-gray-700">{siteUrl}</span> : <span className="text-amber-600">none found on this account</span>}
            {" · "}
            GA4 property: {propertyName ? <span className="font-medium text-gray-700">{propertyName}</span> : <span className="text-amber-600">none found on this account</span>}
          </div>
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
