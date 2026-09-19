"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDot, Loader2, RefreshCw } from "lucide-react";
import type { Finding, FindingStatus } from "@/lib/domain/findings/findingTypes";

const STATUS_ORDER: FindingStatus[] = ["new", "acknowledged", "fixing", "fixed", "verified"];

const STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  fixing: "Fixing",
  fixed: "Fixed",
  verified: "Verified",
  failed: "Verification failed",
};

const STATUS_ACTION: Partial<Record<FindingStatus, { next: FindingStatus; label: string }>> = {
  new: { next: "acknowledged", label: "Acknowledge" },
  acknowledged: { next: "fixing", label: "Start fixing" },
  fixing: { next: "fixed", label: "Mark fixed" },
  failed: { next: "fixing", label: "Resume fixing" },
};

function severityClass(severity: Finding["severity"]) {
  if (severity === "critical") return "bg-red-50 text-red-700 border-red-200";
  if (severity === "warning") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function statusClass(status: FindingStatus) {
  if (status === "verified") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "failed") return "bg-red-50 text-red-700 border-red-200";
  if (status === "fixing") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function EvidenceValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-[12px] first:border-t-0">
      <span className="text-gray-500">{label}</span>
      <span className="max-w-[65%] truncate font-medium text-gray-800">
        {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
      </span>
    </div>
  );
}

export default function FindingsWorkspace() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<"verified" | "failed" | null>(null);

  const selected = findings.find((finding) => finding.id === selectedId) ?? null;

  const counts = useMemo(() => ({
    active: findings.filter((f) => !["verified"].includes(f.status)).length,
    critical: findings.filter((f) => f.severity === "critical" && f.status !== "verified").length,
    warning: findings.filter((f) => f.severity === "warning" && f.status !== "verified").length,
    verified: findings.filter((f) => f.status === "verified").length,
  }), [findings]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/analytics/findings");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load findings.");
      setFindings(Array.isArray(data.findings) ? data.findings : []);
      setSelectedId((current) => current && data.findings.some((f: Finding) => f.id === current) ? current : data.findings[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load findings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const mutate = async (body: Record<string, string>) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setVerification(null);
    try {
      const response = await fetch("/api/agents/analytics/findings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Finding update failed.");
      if (data.finding) {
        setFindings((current) => current.map((finding) => finding.id === data.finding.id ? data.finding : finding));
        setSelectedId(data.finding.id);
      }
      if (body.action === "recheck") setVerification(data.verification?.status ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finding update failed.");
    } finally {
      setBusy(false);
    }
  };

  const evidence = selected?.evidence ?? {};
  const page = (evidence.page ?? {}) as Record<string, unknown>;
  const meta = (page.meta ?? {}) as Record<string, unknown>;
  const relevance = (page.contentRelevance ?? {}) as Record<string, unknown>;
  const timing = (page.serverTiming ?? {}) as Record<string, unknown>;

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-gray-500"><Loader2 size={18} className="mr-2 animate-spin" />Loading findings...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}<button onClick={() => void load()} className="ml-3 font-medium underline">Retry</button></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Findings</h3>
        <p className="mt-0.5 text-[11px] text-gray-500">Turn search opportunities into issues you can fix and verify.</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          ["Needs attention", counts.active],
          ["Critical", counts.critical],
          ["Warnings", counts.warning],
          ["Verified", counts.verified],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
          </div>
        ))}
      </div>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
          <Check className="mx-auto mb-2 text-emerald-500" size={22} />
          <p className="text-sm font-medium text-gray-800">No findings yet</p>
          <p className="mt-1 text-[12px] text-gray-500">Inspect a ranking-page opportunity in Traffic and create a finding to track it here.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {findings.map((finding) => (
              <button
                key={finding.id}
                onClick={() => { setSelectedId(finding.id); setVerification(null); }}
                className={`block w-full border-t border-gray-100 p-3 text-left first:border-t-0 hover:bg-gray-50 ${selected?.id === finding.id ? "bg-gray-50" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <CircleDot size={14} className={finding.severity === "critical" ? "mt-0.5 text-red-500" : finding.severity === "warning" ? "mt-0.5 text-amber-500" : "mt-0.5 text-gray-400"} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityClass(finding.severity)}`}>{finding.severity}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${statusClass(finding.status)}`}>{STATUS_LABEL[finding.status]}</span>
                    </div>
                    <div className="truncate text-[13px] font-medium text-gray-900">{finding.recommendation.split(".")[0]}</div>
                    <div className="mt-1 truncate text-[11px] text-gray-500">{finding.entityId} · {finding.url ?? "No page URL"}</div>
                  </div>
                  <ChevronRight size={14} className="mt-1 shrink-0 text-gray-300" />
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${severityClass(selected.severity)}`}>{selected.severity}</span>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${statusClass(selected.status)}`}>{STATUS_LABEL[selected.status]}</span>
                    </div>
                    <h4 className="text-base font-semibold text-gray-900">{selected.recommendation.split(".")[0]}</h4>
                    <div className="mt-1 text-[11px] text-gray-500">Query: <span className="font-medium text-gray-700">{selected.entityId}</span></div>
                    {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[11px] text-[#00846f] hover:underline">{selected.url}</a>}
                  </div>
                  <button onClick={() => void load()} title="Refresh findings" className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"><RefreshCw size={13} /></button>
                </div>
              </div>

              <div className="space-y-4 p-4">
                {verification && (
                  <div className={`flex items-start gap-2 rounded-xl border p-3 text-[12px] ${verification === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                    {verification === "verified" ? <Check size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}
                    <div><div className="font-semibold">{verification === "verified" ? "VERIFIED" : "VERIFICATION FAILED"}</div><div className="mt-0.5">{verification === "verified" ? "The issue is no longer detected on this page." : "The issue is still detected. Keep fixing it and re-check again."}</div></div>
                  </div>
                )}

                <section>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Why this was flagged</div>
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    <EvidenceValue label="Clicks" value={evidence.clicks} />
                    <EvidenceValue label="Impressions" value={evidence.impressions} />
                    <EvidenceValue label="CTR" value={typeof evidence.ctr === "number" ? `${(evidence.ctr * 100).toFixed(1)}%` : evidence.ctr} />
                    <EvidenceValue label="Position" value={evidence.position} />
                    <EvidenceValue label="Indexable" value={meta.indexable} />
                    <EvidenceValue label="Canonical" value={meta.canonical ?? "Missing"} />
                    <EvidenceValue label="Keyword relevance" value={typeof relevance.keywordRelevance === "number" ? `${relevance.keywordRelevance}%` : relevance.keywordRelevance} />
                    <EvidenceValue label="TTFB" value={typeof timing.ttfbMs === "number" ? `${Math.round(timing.ttfbMs)} ms` : null} />
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Recommendation</div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] leading-5 text-gray-700">{selected.recommendation}</div>
                </section>

                <section>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Lifecycle</div>
                  <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {STATUS_ORDER.map((status, index) => (
                      <div key={status} className="flex shrink-0 items-center gap-1">
                        <div className={`flex h-7 items-center rounded-full border px-2 text-[10px] font-medium ${selected.status === status ? statusClass(status) : index < STATUS_ORDER.indexOf(selected.status) ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-400"}`}>
                          {STATUS_LABEL[status]}
                        </div>
                        {index < STATUS_ORDER.length - 1 && <ChevronRight size={11} className="text-gray-300" />}
                      </div>
                    ))}
                  </div>
                </section>

                <div className="flex flex-wrap gap-2">
                  {STATUS_ACTION[selected.status] && (
                    <button disabled={busy} onClick={() => void mutate({ status: STATUS_ACTION[selected.status]!.next })} className="rounded-lg bg-[#111111] px-3 py-2 text-[12px] font-medium text-white hover:bg-black disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="inline animate-spin" /> : STATUS_ACTION[selected.status]!.label}
                    </button>
                  )}
                  {(selected.status === "fixing" || selected.status === "fixed" || selected.status === "failed") && (
                    <button disabled={busy} onClick={() => void mutate({ action: "recheck" })} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {busy ? "Checking..." : "Re-check"}
                    </button>
                  )}
                </div>

                <div className="text-[10px] text-gray-400">First seen {new Date(selected.firstSeen).toLocaleDateString()} · Last checked {new Date(selected.lastSeen).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
