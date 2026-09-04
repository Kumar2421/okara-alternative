"use client";

import { useState, useEffect } from "react";
import { BarChart2, ChevronLeft, Link2, X, Lock, Search, Cpu, Globe2, Check, Loader2, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import ScoreCircle from "./ScoreCircle";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import type { GeoCitationRow } from "@/lib/domain/geo/GEOAgent";
import { useProject } from "@/lib/project-store";
import { useTerminalLog } from "@/lib/terminal-log-store";

const TABS = ["SEO", "Links", "Technical", "GEO"] as const;
type Tab = (typeof TABS)[number];

type CheckedLink = { href: string; text: string; internal: boolean; reachable: boolean; status?: number };
type PageSpeedScores = { performance: number; accessibility: number; bestPractices: number; seo: number };
type CrawledPage = {
  url: string;
  title: string;
  content: string;
  source: "crawl" | "jina-fallback";
  pageSpeed?: { desktop: PageSpeedScores; mobile: PageSpeedScores };
  pageSpeedError?: string;
};

function ConnectGoogleServices() {
  const [dismissed, setDismissed] = useState(false);
  const [gaConnected, setGaConnected] = useState(false);
  const [gscConnected, setGscConnected] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-gray-500">
          CONNECT GOOGLE SERVICES
        </span>
        <X size={13} className="cursor-pointer text-gray-400" onClick={() => setDismissed(true)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* GA Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-0.5 text-[13px] font-semibold text-gray-900">Google Analytics</div>
          <div className="mb-3 text-[11px] text-gray-500">Traffic &amp; behavior</div>
          <div className="relative mb-3 flex h-14 items-end gap-1.5">
            {[10, 16, 12, 22, 34, 26, 42].map((h, i) => (
              <div key={i} className={`flex-1 rounded-t ${gaConnected ? "bg-[#00ab92]" : "bg-[#f9d0ae]"}`} style={{ height: `${h}px` }} />
            ))}
            {!gaConnected && (
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow">
                <Lock size={13} className="text-gray-500" />
              </div>
            )}
          </div>
          {gaConnected ? (
            <div className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#e6f7f4] py-1.5 text-[13px] font-medium text-[#00846f]">
              <Check size={13} /> Connected
            </div>
          ) : (
            <button onClick={() => setGaConnected(true)} className="w-full rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black">
              Connect
            </button>
          )}
        </div>
        {/* GSC Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-0.5 text-[13px] font-semibold text-gray-900">Search Console</div>
          <div className="mb-3 text-[11px] text-gray-500">Search rankings</div>
          <div className="relative mb-3 flex h-14 items-center justify-center">
            <svg viewBox="0 0 100 40" className="h-10 w-full">
              <polyline points="0,32 15,26 30,28 45,14 60,18 75,6 100,10" fill="none" stroke={gscConnected ? "#00ab92" : "#93c5fd"} strokeWidth="3" />
            </svg>
            {!gscConnected && (
              <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow">
                <Lock size={13} className="text-gray-500" />
              </div>
            )}
          </div>
          {gscConnected ? (
            <div className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#e6f7f4] py-1.5 text-[13px] font-medium text-[#00846f]">
              <Check size={13} /> Connected
            </div>
          ) : (
            <button onClick={() => setGscConnected(true)} className="w-full rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black">
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="mb-3 mt-0.5 text-[12px] text-gray-500">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: "good" | "warn" | "bad" | "Pass" | "Warn" | "Fail" }) {
  const color = (status === "good" || status === "Pass") ? "bg-[#00ab92]" : (status === "warn" || status === "Warn") ? "bg-amber-500" : "bg-red-500";
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} />;
}

export default function AnalyticsPanel({ open, onToggle }: { open: boolean; onToggle: () => void; }) {
  const [tab, setTab] = useState<Tab>("SEO");
  const [auditData, setAuditData] = useState<SEOAuditPayload | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const [linksResult, setLinksResult] = useState<{ links: CheckedLink[]; checkedAt: string } | null>(null);
  const [linksChecking, setLinksChecking] = useState(false);
  const [geoResult, setGeoResult] = useState<{ rows: GeoCitationRow[]; checkedAt: string } | null>(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [siteCrawlResult, setSiteCrawlResult] = useState<{ pages: CrawledPage[]; checkedAt: string } | null>(null);
  const [siteCrawling, setSiteCrawling] = useState(false);
  const [pageSpeedRunning, setPageSpeedRunning] = useState(false);
  const { show } = useToast();
  const { project } = useProject();
  const { log, logDone } = useTerminalLog();

  useEffect(() => {
    if (open && project?.url) {
      loadAudit(project.url);
    }
  }, [open, project?.url]);

  useEffect(() => {
    if (!open || !project) return;
    if (tab === "Links" && !linksResult) {
      fetch("/api/agents/links/check")
        .then((r) => r.json())
        .then((data) => data.result && setLinksResult(data.result))
        .catch(() => {});
    }
    if (tab === "GEO" && !geoResult) {
      fetch("/api/agents/geo/check")
        .then((r) => r.json())
        .then((data) => data.result && setGeoResult(data.result))
        .catch(() => {});
    }
    if (tab === "Links" && !siteCrawlResult) {
      fetch("/api/agents/site-crawl/run")
        .then((r) => r.json())
        .then((data) => data.result && setSiteCrawlResult(data.result))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, tab]);

  const handleCheckLinks = async () => {
    setLinksChecking(true);
    log("Checking link reachability...");
    try {
      const res = await fetch("/api/agents/links/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to check links"}`);
        show(data.error || "Failed to check links.");
        return;
      }
      setLinksResult(data.result);
      const broken = data.result.links.filter((l: CheckedLink) => !l.reachable).length;
      logDone(broken > 0 ? `Checked ${data.result.links.length} links — ${broken} broken.` : `Checked ${data.result.links.length} links — all reachable.`);
    } catch {
      log("⚠ Failed to check links.");
      show("Failed to check links.");
    } finally {
      setLinksChecking(false);
    }
  };

  const handleCrawlSite = async () => {
    setSiteCrawling(true);
    log("Crawling the rest of the site (checking each page, JS-rendering fallback if needed)...");
    try {
      const res = await fetch("/api/agents/site-crawl/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to crawl site"}`);
        show(data.error || "Failed to crawl site.");
        return;
      }
      setSiteCrawlResult(data.result);
      const viaJina = data.result.pages.filter((p: CrawledPage) => p.source === "jina-fallback").length;
      logDone(
        `Crawled ${data.result.pages.length} page${data.result.pages.length === 1 ? "" : "s"}${viaJina > 0 ? ` (${viaJina} via JS-render fallback)` : ""}.`
      );
    } catch {
      log("⚠ Failed to crawl site.");
      show("Failed to crawl site.");
    } finally {
      setSiteCrawling(false);
    }
  };

  const handleRunPageSpeedForCrawledPages = async () => {
    setPageSpeedRunning(true);
    log(`Running real PageSpeed for ${siteCrawlResult?.pages.length ?? 0} crawled page(s) — this can take a minute...`);
    try {
      const res = await fetch("/api/agents/site-crawl/pagespeed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to run PageSpeed"}`);
        show(data.error || "Failed to run PageSpeed.");
        return;
      }
      setSiteCrawlResult(data.result);
      const scored = data.result.pages.filter((p: CrawledPage) => p.pageSpeed).length;
      logDone(`Real PageSpeed scores fetched for ${scored} of ${data.result.pages.length} pages.`);
    } catch {
      log("⚠ Failed to run PageSpeed.");
      show("Failed to run PageSpeed.");
    } finally {
      setPageSpeedRunning(false);
    }
  };

  const handleRunGeoCheck = async () => {
    setGeoChecking(true);
    log("Checking AI search citations...");
    try {
      const res = await fetch("/api/agents/geo/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to run GEO check"}`);
        show(data.error || "Failed to run GEO check.");
        return;
      }
      setGeoResult(data.result);
      const gaps = data.result.rows.filter((r: GeoCitationRow) => !r.found).length;
      logDone(gaps > 0 ? `GEO check done — ${gaps} citation gap${gaps === 1 ? "" : "s"} found.` : "GEO check done — cited in every query checked.");
    } catch {
      log("⚠ Failed to run GEO check.");
      show("Failed to run GEO check.");
    } finally {
      setGeoChecking(false);
    }
  };

  const loadAudit = async (url: string) => {
    try {
      const res = await fetch(`/api/agents/seo/audit?url=${encodeURIComponent(url)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.payload) {
          setAuditData(JSON.parse(data.payload));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunAudit = async () => {
    if (!project?.url) {
      show("Add a website in the project switcher at the top first.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/agents/seo/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: project.url }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuditData(data);
        show("SEO Audit completed!");
      } else {
        const err = await res.json();
        show(`Error: ${err.error}`);
      }
    } catch (e) {
      show("Failed to run SEO audit.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Search size={15} />} label="SEO" active={tab === "SEO"} onClick={() => { setTab("SEO"); onToggle(); }} />
        <RailButton icon={<Link2 size={15} />} label="Links" active={tab === "Links"} onClick={() => { setTab("Links"); onToggle(); }} />
        <RailButton icon={<Cpu size={15} />} label="Technical" active={tab === "Technical"} onClick={() => { setTab("Technical"); onToggle(); }} />
        <RailButton icon={<Globe2 size={15} />} label="GEO" active={tab === "GEO"} onClick={() => { setTab("GEO"); onToggle(); }} />
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <BarChart2 size={15} className="text-gray-500" /> Analytics
        </div>
        <div className="flex items-center gap-3 text-gray-400">
          <button onClick={onToggle} title="Collapse" className="hover:text-gray-700">
            <ChevronLeft size={15} />
          </button>
        </div>
      </div>

      {project?.url && (
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[12px] text-gray-600 hover:underline"
          >
            {project.url.replace(/^https?:\/\//, "")}
          </a>
          <button
            onClick={handleRunAudit}
            disabled={loading}
            title="Re-run audit"
            className="flex shrink-0 items-center justify-center rounded-md bg-[#111111] px-2.5 py-1.5 text-white hover:bg-black disabled:opacity-70"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b border-gray-200 p-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${tab === t ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="okara-scroll flex-1 overflow-y-auto p-4">
        {!auditData ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
             {loading ? <Loader2 className="animate-spin text-gray-400 mb-2" size={24} /> : <Search className="text-gray-300 mb-2" size={24} />}
             <p className="text-sm">
               {loading
                 ? "Auditing your website..."
                 : project?.url
                   ? "No audit yet — click refresh above to run one."
                   : "Add a website in the project switcher at the top to see insights."}
             </p>
          </div>
        ) : (
          <>
            {tab === "SEO" && (
              <>
                <ConnectGoogleServices />

                {!auditData.pageSpeed && (
                  <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      No PageSpeed API key connected, so Performance/Accessibility/Best Practices/SEO scores and
                      Core Web Vitals aren&apos;t available — below is real data from our own crawl instead, not a
                      substitute score. Connect a key in{" "}
                      <span className="font-medium">Settings → LLM Providers → API Services</span> for real
                      Lighthouse scores.
                    </span>
                  </div>
                )}

                <Section title="PageSpeed Scores">
                  {auditData.pageSpeed ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-2 text-[11px] font-semibold tracking-wide text-gray-500">DESKTOP</div>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        <ScoreCircle value={auditData.pageSpeed.desktop.performance} label="Performance" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.accessibility} label="Accessibility" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.bestPractices} label="Best Practices" />
                        <ScoreCircle value={auditData.pageSpeed.desktop.seo} label="SEO" />
                      </div>
                      <div className="mb-2 text-[11px] font-semibold tracking-wide text-gray-500">MOBILE</div>
                      <div className="grid grid-cols-4 gap-2">
                        <ScoreCircle value={auditData.pageSpeed.mobile.performance} label="Performance" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.accessibility} label="Accessibility" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.bestPractices} label="Best Practices" />
                        <ScoreCircle value={auditData.pageSpeed.mobile.seo} label="SEO" />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex items-center gap-4">
                        <ScoreCircle value={auditData.technical.onPageScore} label="On-Page" size={56} />
                        <p className="text-[12px] text-gray-500">
                          Real on-page checks passed, from our own crawl — not a Lighthouse Performance score.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-1 text-[11px] uppercase text-gray-500">Page Size</div>
                          <div className="text-lg font-semibold text-gray-900">{(auditData.technical.pageSizeBytes / 1024).toFixed(1)} KB</div>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-1 text-[11px] uppercase text-gray-500">DOM Size</div>
                          <div className="text-lg font-semibold text-gray-900">{auditData.technical.domSize} elements</div>
                        </div>
                      </div>
                    </div>
                  )}
                </Section>

                <Section title="Core Web Vitals">
                  {auditData.coreWebVitals ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex rounded-lg bg-gray-200/70 p-1 text-[13px]">
                        <button
                          onClick={() => setDevice("desktop")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "desktop" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Desktop
                        </button>
                        <button
                          onClick={() => setDevice("mobile")}
                          className={`flex-1 rounded-md py-1.5 font-medium ${device === "mobile" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                        >
                          Mobile
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries(auditData.coreWebVitals[device]).map(([key, v]) => (
                          <div key={key} className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase text-gray-500">
                              <StatusDot status={v.status} /> {key}
                            </div>
                            <div className={`text-lg font-semibold ${v.status === "Pass" ? "text-[#00ab92]" : v.status === "Warn" ? "text-amber-600" : "text-red-600"}`}>
                              {v.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="mb-3 text-[12px] text-gray-500">
                        Not LCP/FCP/CLS (that needs a real browser render) — real connection-phase timing from our
                        own crawl instead.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          ["TTFB", auditData.serverTiming.ttfbMs],
                          ["Download", auditData.serverTiming.downloadMs],
                          ["Connection", auditData.serverTiming.connectMs],
                          ["TLS Handshake", auditData.serverTiming.tlsHandshakeMs],
                        ].map(([label, ms]) => (
                          <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {typeof ms === "number" ? `${Math.round(ms)}ms` : "N/A"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>

                <Section title="Issues">
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                     {auditData.issues.length === 0 ? (
                       <div className="p-3 text-sm text-gray-500">No issues found!</div>
                     ) : (
                        auditData.issues.map((issue, i) => (
                          <div key={i} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <span className="flex items-center gap-2 text-gray-700">
                              <span className={issue.level === "Error" ? "text-red-500" : "text-amber-500"}>⚠</span> {issue.label}
                            </span>
                          </div>
                        ))
                     )}
                  </div>
                </Section>
              </>
            )}

            {tab === "Links" && (
              <Section
                title="Links"
                subtitle={`${auditData.links.length} link${auditData.links.length === 1 ? "" : "s"} found on this page${auditData.links.length >= 50 ? " (capped at 50)" : ""}`}
              >
                {auditData.links.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">
                    No links found on this page.
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleCheckLinks}
                      disabled={linksChecking}
                      className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                    >
                      {linksChecking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {linksChecking ? "Checking..." : linksResult ? "Re-check reachability" : "Check reachability"}
                    </button>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.links.map((link, i) => {
                        const checked = linksResult?.links.find((l) => l.href === link.href);
                        return (
                          <div key={i} className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${link.internal ? "bg-gray-100 text-gray-600" : "bg-blue-50 text-blue-600"}`}>
                                  {link.internal ? "Internal" : "External"}
                                </span>
                                <a href={link.href} target="_blank" rel="noreferrer" className="truncate text-gray-800 hover:underline">
                                  {link.text || link.href}
                                </a>
                              </div>
                              <div className="truncate text-[11px] text-gray-400">{link.href}</div>
                            </div>
                            {checked && (
                              <span className={`shrink-0 flex items-center gap-1 text-[11px] font-medium ${checked.reachable ? "text-[#00ab92]" : "text-red-600"}`}>
                                {checked.reachable ? <Check size={11} /> : "⚠"}
                                {checked.status ?? (checked.reachable ? "OK" : "Failed")}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Section>
            )}

            {tab === "Links" && (
              <Section
                title="Site Pages"
                subtitle="Crawls beyond the homepage — real content per page, with a JS-render fallback for pages that come back empty (client-rendered apps)"
              >
                <button
                  onClick={handleCrawlSite}
                  disabled={siteCrawling || auditData.links.filter((l) => l.internal).length === 0}
                  className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {siteCrawling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {siteCrawling ? "Crawling..." : siteCrawlResult ? "Re-crawl site" : "Crawl full site"}
                </button>

                {!siteCrawlResult ? (
                  auditData.links.filter((l) => l.internal).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-[13px] text-gray-500">
                      No internal links discovered yet to crawl from.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-[13px] text-gray-500">
                      Follows the internal links found above, fetching each page's real content — no key required.
                    </div>
                  )
                ) : siteCrawlResult.pages.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">No pages could be crawled.</div>
                ) : (
                  <>
                    <button
                      onClick={handleRunPageSpeedForCrawledPages}
                      disabled={pageSpeedRunning}
                      className="mb-3 flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {pageSpeedRunning ? <Loader2 size={12} className="animate-spin" /> : <BarChart2 size={12} />}
                      {pageSpeedRunning ? "Running PageSpeed..." : "Run PageSpeed for crawled pages"}
                    </button>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {siteCrawlResult.pages.map((page, i) => (
                        <div key={i} className="border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                          <div className="flex items-center gap-1.5">
                            <a href={page.url} target="_blank" rel="noreferrer" className="truncate font-medium text-gray-800 hover:underline">
                              {page.title || page.url}
                            </a>
                            {page.source === "jina-fallback" && (
                              <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                JS-rendered
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-gray-400">{page.url}</div>
                          <p className="mt-1 line-clamp-2 text-[12px] text-gray-500">{page.content.slice(0, 200)}</p>
                          {page.pageSpeed && (
                            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                              {(["performance", "accessibility", "bestPractices", "seo"] as const).map((k) => (
                                <span key={k} className="text-gray-600">
                                  <span className="font-semibold text-gray-900">{page.pageSpeed!.desktop[k]}</span>{" "}
                                  {k === "bestPractices" ? "Best Practices" : k[0].toUpperCase() + k.slice(1)}
                                </span>
                              ))}
                            </div>
                          )}
                          {page.pageSpeedError && (
                            <div className="mt-1 text-[11px] text-amber-600">⚠ PageSpeed: {page.pageSpeedError}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Section>
            )}

            {tab === "Technical" && (
              <>
                <Section title="On-Page Overview" subtitle="Server configuration and page characteristics">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-4 flex items-center gap-4">
                      <ScoreCircle value={auditData.technical.onPageScore} label="On-Page" size={64} />
                      <p className="text-[12px] text-gray-500">
                        Real checks passed — meta length, single H1, OG/Twitter tags, cacheable response. Not a
                        Lighthouse score.
                      </p>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      {[
                        ["Server", auditData.technical.server ?? "Not disclosed"],
                        ["Status", String(auditData.technical.status)],
                        ["Encoding", auditData.technical.encoding ?? "None"],
                        ["Page Size", `${(auditData.technical.pageSizeBytes / 1024).toFixed(1)} KB`],
                        ["DOM Size", `${auditData.technical.domSize} elements`],
                        ["Cacheable", auditData.technical.cacheable ? "Yes" : "No"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                          <span className="font-medium text-gray-500">{label}</span>
                          <span className="font-medium text-gray-800">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section title="Server Timing" subtitle="Real connection-phase timing from this crawl, not Lighthouse">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ["Connection", auditData.serverTiming.connectMs],
                      ["TLS Handshake", auditData.serverTiming.tlsHandshakeMs],
                      ["TTFB", auditData.serverTiming.ttfbMs],
                      ["Download", auditData.serverTiming.downloadMs],
                    ].map(([label, ms]) => (
                      <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {typeof ms === "number" ? `${Math.round(ms)}ms` : "N/A"}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Render Blocking" subtitle="Scripts and stylesheets blocking page render">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Blocking Scripts</div>
                      <div className="text-lg font-semibold text-gray-900">{auditData.renderBlocking.blockingScripts}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-1 text-[11px] uppercase text-gray-500">Blocking Stylesheets</div>
                      <div className="text-lg font-semibold text-gray-900">{auditData.renderBlocking.blockingStylesheets}</div>
                    </div>
                  </div>
                </Section>

                <Section title="Content Relevance" subtitle="How well your metadata matches page content">
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    {[
                      ["Title Relevance", auditData.contentRelevance.titleRelevance],
                      ["Description Relevance", auditData.contentRelevance.descriptionRelevance],
                      ["Keyword Relevance", auditData.contentRelevance.keywordRelevance],
                    ].map(([label, pct]) => (
                      <div key={label as string}>
                        <div className="mb-1 flex items-center justify-between text-[13px]">
                          <span className="text-gray-700">{label}</span>
                          <span className="font-medium text-gray-900">{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div className="h-full rounded-full bg-[#00ab92]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Distribution of heading tags across the page">
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    {Object.entries(auditData.headings).map(([tag, count]) => (
                      <div key={tag} className="flex justify-between text-sm">
                        <span className="uppercase text-gray-500 font-medium">{tag}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Social Media Tags" subtitle="Open Graph and Twitter card metadata">
                  <div className="mb-3">
                    <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Open Graph</h4>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.openGraph.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500">No Open Graph tags detected on this page.</div>
                      ) : (
                        auditData.openGraph.map((tag, i) => (
                          <div key={i} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <span className="flex items-center gap-2 text-[#00ab92]">✓ {tag.key}</span>
                            <span className="max-w-[55%] truncate text-gray-500">{tag.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-[12px] font-semibold text-gray-700">Twitter</h4>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {auditData.twitter.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500">No Twitter card tags detected on this page.</div>
                      ) : (
                        auditData.twitter.map((tag, i) => (
                          <div key={i} className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                            <span className="flex items-center gap-2 text-[#00ab92]">✓ {tag.key}</span>
                            <span className="max-w-[55%] truncate text-gray-500">{tag.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </Section>
              </>
            )}

            {tab === "GEO" && (
              <Section
                title="AI Citation Check"
                subtitle="Real search-grounded check for whether your site is surfaced when people search around your product"
              >
                <button
                  onClick={handleRunGeoCheck}
                  disabled={geoChecking}
                  className="mb-3 flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {geoChecking ? <Loader2 size={12} className="animate-spin" /> : <Globe2 size={12} />}
                  {geoChecking ? "Checking..." : geoResult ? "Re-check" : "Run GEO Check"}
                </button>

                {!geoResult ? (
                  <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-[13px] text-gray-500">
                    <Globe2 className="mx-auto mb-2 text-gray-300" size={28} />
                    Searches the live web for real queries around your product and checks whether your own
                    domain actually shows up — a real citation gap, not a guess. Requires a Tavily API key
                    (Settings → LLM Providers).
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    {geoResult.rows.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5 text-[13px] first:border-t-0">
                        <span className="text-gray-700">&ldquo;{row.query}&rdquo;</span>
                        {row.found ? (
                          <a
                            href={row.matchedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#00ab92] hover:underline"
                          >
                            <Check size={12} /> Cited <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-amber-600">⚠ Gap</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
