"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Finding = {
  issueId: string;
  category: string;
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
};

type AuditResult = {
  url: string;
  findings: Finding[];
  summary: { totalFindings: number; critical: number; warnings: number };
  technical: { onPageScore: number; status: number; redirectCount: number };
};

function evidenceText(evidence: Record<string, string | number | null>) {
  const values = Object.entries(evidence)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 2)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: ${value}`);
  return values.join(" · ");
}

export default function AuditPage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/public/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audit failed.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fafaf8] text-[#111111]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/login" className="text-sm font-bold tracking-tight">Marlo</Link>
          <Link href="/login" className="text-sm text-black/60 hover:text-black">Sign in</Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">Free website audit</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.05em] sm:text-6xl sm:leading-[1.02]">
            Find the SEO problems holding your website back.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-black/60 sm:text-lg">
            Enter a public website. Marlo checks the page and shows the most important issues it can verify right now.
          </p>
        </div>

        <form onSubmit={runAudit} className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://yourwebsite.com"
            type="url"
            required
            className="h-12 flex-1 rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-black"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-lg bg-[#111111] px-6 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Auditing..." : "Run free audit"}
          </button>
        </form>

        {error && (
          <div className="mt-4 max-w-2xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <section className="mt-14 max-w-4xl">
            <div className="flex flex-col justify-between gap-4 border-b border-black/10 pb-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs uppercase tracking-wider text-black/40">Audit result</p>
                <h2 className="mt-1 break-all text-xl font-medium">{result.url}</h2>
              </div>
              <div className="text-sm text-black/55">
                {result.summary.totalFindings} finding{result.summary.totalFindings === 1 ? "" : "s"} detected
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {result.findings.map((finding) => (
                <article key={finding.issueId} className="rounded-xl border border-black/10 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${finding.severity === "Error" ? "text-red-600" : "text-amber-600"}`}>
                      {finding.severity === "Error" ? "Important" : "Warning"}
                    </span>
                    <span className="text-[11px] text-black/35">{finding.category}</span>
                  </div>
                  <h3 className="mt-4 text-base font-medium">{finding.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/55">
                    {evidenceText(finding.evidence) || "The audit detected this issue on the page."}
                  </p>
                </article>
              ))}
              {result.findings.length === 0 && (
                <div className="sm:col-span-3 rounded-xl border border-black/10 bg-white p-6 text-sm text-black/60">
                  No issues were detected by the checks in this quick audit.
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-5 rounded-xl bg-[#111111] p-7 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-medium">Want the full report?</h3>
                <p className="mt-1 text-sm leading-6 text-white/60">
                  Create a Marlo account to save findings, get recommendations, and recheck improvements.
                </p>
              </div>
              <Link href="/login?mode=signup" className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black">
                Create free account
              </Link>
            </div>
          </section>
        )}

        <p className="mt-10 text-xs leading-5 text-black/40">
          Quick audits are limited to public HTTP/HTTPS websites. Do not submit private, local, or internal addresses.
        </p>
      </section>
    </main>
  );
}
