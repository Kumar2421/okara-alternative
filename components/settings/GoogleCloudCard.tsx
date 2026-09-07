"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";

/** One Google Cloud API key unlocks 3 real features that all use plain
 * API-key auth (no OAuth): Places API (Leads → Local Business mode),
 * Custom Search JSON API (extra Leads search source), Knowledge Graph
 * Search API (Competitor Analysis enrichment). Custom Search additionally
 * needs a Programmable Search Engine ID (cx) — a separate real setup step
 * at programmablesearchengine.google.com, not just an API key. */
export default function GoogleCloudCard() {
  const { show } = useToast();
  const [connected, setConnected] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [cx, setCx] = useState("");
  const [savedCx, setSavedCx] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const keyRow = data.settings?.find((s) => s.key === "google_cloud_api_key");
        if (keyRow?.value) {
          setConnected(true);
          setKeyPreview(`${keyRow.value.slice(0, 4)}••••${keyRow.value.slice(-2)}`);
        }
        const cxRow = data.settings?.find((s) => s.key === "google_cse_id");
        if (cxRow?.value) {
          setSavedCx(cxRow.value);
          setCx(cxRow.value);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
  }

  async function handleConnect() {
    if (!keyInput.trim()) {
      show("Enter a Google Cloud API key first.");
      return;
    }
    setBusy(true);
    try {
      await saveSetting("google_cloud_api_key", keyInput.trim());
      setConnected(true);
      setKeyPreview(`${keyInput.trim().slice(0, 4)}••••${keyInput.trim().slice(-2)}`);
      setKeyInput("");
      show("Google Cloud connected — Places, Custom Search, and Knowledge Graph are live.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect Google Cloud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await saveSetting("google_cloud_api_key", "");
      setConnected(false);
      setKeyPreview("");
      show("Google Cloud disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect Google Cloud.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCx() {
    setBusy(true);
    try {
      await saveSetting("google_cse_id", cx.trim());
      setSavedCx(cx.trim());
      show(cx.trim() ? "Search Engine ID saved." : "Search Engine ID cleared.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Search Engine ID.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <BrandIcon id="google-cloud" color="#4285f4" fallback="G" />
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              Google Cloud API Key
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Enable Places API, Custom Search API, and Knowledge Graph Search API on this key in Cloud
              Console. Powers Leads → Local Business search, an extra Leads search source, and real
              Competitor Analysis enrichment.
            </div>
          </div>
        </div>
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
        >
          Get key <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="font-mono">{keyPreview}</span>
          <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="AIza..."
            type="password"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <button
            onClick={handleConnect}
            disabled={busy}
            className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {busy ? "Connecting..." : "Connect"}
          </button>
        </div>
      )}

      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="mb-1 flex items-center justify-between text-[12px]">
          <span className="font-medium text-gray-700">Programmable Search Engine ID (cx)</span>
          <a
            href="https://programmablesearchengine.google.com/controlpanel/all"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-gray-400 hover:text-gray-700"
          >
            Create one <ExternalLink size={10} />
          </a>
        </div>
        <p className="mb-2 text-[11px] text-gray-500">
          Required separately for Custom Search — set it to search the entire web, not one site.
        </p>
        <div className="flex gap-2">
          <input
            value={cx}
            onChange={(e) => setCx(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveCx()}
            placeholder="e.g. a1b2c3d4e5f6g7h8i"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <button
            onClick={handleSaveCx}
            disabled={busy || cx === savedCx}
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
