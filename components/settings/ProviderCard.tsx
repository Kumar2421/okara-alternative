"use client";

import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import type { Provider } from "@/lib/mock-providers";
import { useProviders } from "@/lib/providers-store";
import { useToast } from "@/components/dashboard/Toast";

export default function ProviderCard({ provider }: { provider: Provider }) {
  const { state, connect, disconnect, primaryModel, setPrimaryModel } = useProviders();
  const { show } = useToast();
  const [keyInput, setKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState(provider.baseUrlPlaceholder ?? "");

  const connection = state[provider.id];
  const isConnected = !!connection?.connected;
  const needsKey = provider.requiresKey !== false;
  const needsBaseUrl = !!provider.requiresBaseUrl;

  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    if (needsKey && !keyInput.trim()) {
      show("Enter an API key first.");
      return;
    }
    if (needsBaseUrl && !baseUrlInput.trim()) {
      show("Enter a base URL first.");
      return;
    }
    setBusy(true);
    try {
      await connect(provider.id, keyInput.trim(), needsBaseUrl ? baseUrlInput.trim() : undefined);
      show(`${provider.name} connected.`);
      setKeyInput("");
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to connect ${provider.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnect(provider.id);
      show(`${provider.name} disconnected.`);
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to disconnect ${provider.name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold text-white"
            style={{ backgroundColor: provider.color }}
          >
            {provider.icon}
          </span>
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              {provider.name}
              {isConnected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">{provider.desc}</div>
          </div>
        </div>
        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
          >
            Get key <ExternalLink size={11} />
          </a>
        )}
      </div>

      {isConnected ? (
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            {connection.baseUrl && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Endpoint</span>
                <span className="font-mono">{connection.baseUrl}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="font-mono">
                {/* apiKey already holds the server's masked keyPreview after reconcile, or the raw
                    value briefly right after connect() before the next server round-trip — mask
                    defensively either way so a raw key is never left rendered unmasked. Empty
                    string means "no key needed" for local servers. */}
                {connection.apiKey
                  ? connection.apiKey.includes("•")
                    ? connection.apiKey
                    : `${connection.apiKey.slice(0, 4)}••••${connection.apiKey.slice(-2)}`
                  : "No API key required"}
              </span>
              <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
                Disconnect
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-gray-500">Models</div>
            <div className="flex flex-wrap gap-1.5">
              {provider.models.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setPrimaryModel(m);
                    show(`${m} set as primary model.`);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    primaryModel === m
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {primaryModel === m && "★ "}
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {needsBaseUrl && (
            <input
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !needsKey && handleConnect()}
              placeholder={provider.baseUrlPlaceholder || "http://localhost:1234/v1"}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
          )}
          <div className="flex gap-2">
            {needsKey && (
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder={provider.keyPlaceholder || "API key (optional)"}
                type="password"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
              />
            )}
            <button
              onClick={handleConnect}
              disabled={busy}
              className={`shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50 ${
                needsKey ? "" : "w-full"
              }`}
            >
              {busy ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
