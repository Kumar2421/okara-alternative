"use client";

import { useState, useEffect } from "react";
import { Lock, Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";

export default function ApiIntegrationCard({
  name,
  desc,
  icon,
  color,
  settingKey,
}: {
  name: string;
  desc: string;
  icon: string;
  color: string;
  settingKey: string;
}) {
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const setting = data.settings?.find((s: any) => s.key === settingKey);
        if (setting && setting.value) {
          setApiKey(setting.value);
          setConnected(true);
        }
        setLoading(false);
      });
  }, [settingKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: apiKey }),
      });
      if (res.ok) {
        setConnected(true);
        show(`${name} connected successfully.`);
      } else {
        show(`Failed to connect ${name}.`);
      }
    } catch (e) {
      show(`Error saving ${name} configuration.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: "" }),
      });
      if (res.ok) {
        setApiKey("");
        setConnected(false);
        show(`${name} disconnected.`);
      }
    } catch (e) {
      show(`Error disconnecting ${name}.`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-gray-200 bg-white p-4 h-32 flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-gray-900">{name}</div>
          <div className="truncate text-[12px] text-gray-500">{desc}</div>
        </div>
      </div>
      
      {!connected ? (
        <div className="mt-4 flex flex-col gap-2">
          <input 
            type="password"
            placeholder="API Key / Token"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-70"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Lock size={11} />} 
            Connect
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="flex items-center gap-1.5 text-[12px] text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />
            Connected
          </span>
          <button
            onClick={handleDisconnect}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-70"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
