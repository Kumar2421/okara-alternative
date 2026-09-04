"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  ChevronLeft,
  Pencil,
  Plus,
  ChevronRight,
  RefreshCw,
  Globe,
  FolderOpen,
  Users,
  Link2,
  X,
  Sparkles,
  Loader2,
} from "lucide-react";
import { DOC_TYPES } from "@/lib/document-types";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import { useProject } from "@/lib/project-store";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import ProductInfoPanel from "./documents/ProductInfoPanel";
import MarketingStrategyPanel from "./documents/MarketingStrategyPanel";
import CompetitorAnalysisPanel from "./documents/CompetitorAnalysisPanel";
import ContentStrategyPanel from "./documents/ContentStrategyPanel";
import DesignGuidePanel from "./documents/DesignGuidePanel";

type Competitor = { id: string; url: string; created_at: string };

export default function ContextPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const [docsExpanded, setDocsExpanded] = useState(true);
  const [compsExpanded, setCompsExpanded] = useState(true);
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [marketingStrategyOpen, setMarketingStrategyOpen] = useState(false);
  const [competitorAnalysisOpen, setCompetitorAnalysisOpen] = useState(false);
  const [contentStrategyOpen, setContentStrategyOpen] = useState(false);
  const [designGuideOpen, setDesignGuideOpen] = useState(false);
  const [productInfoExists, setProductInfoExists] = useState(false);
  const [marketingStrategyExists, setMarketingStrategyExists] = useState(false);
  const [competitorAnalysisExists, setCompetitorAnalysisExists] = useState(false);
  const [contentStrategyExists, setContentStrategyExists] = useState(false);
  const [designGuideExists, setDesignGuideExists] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [competitorsLoading, setCompetitorsLoading] = useState(true);
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const { show } = useToast();
  const { project, loading, competitorsVersion } = useProject();
  const { primaryModel } = useProviders();
  const { log } = useTerminalLog();

  const loadCompetitors = useCallback(async () => {
    setCompetitorsLoading(true);
    try {
      const res = await fetch("/api/project/competitors");
      const data = await res.json();
      setCompetitors(data.competitors ?? []);
    } catch {
      // route unreachable — list just stays empty
    } finally {
      setCompetitorsLoading(false);
    }
  }, []);

  const checkDocExists = useCallback(async (apiPath: string, setExists: (v: boolean) => void) => {
    try {
      const res = await fetch(`/api/project/documents/${apiPath}`);
      const data = await res.json();
      setExists(!!data.document?.content);
    } catch {
      setExists(false);
    }
  }, []);

  useEffect(() => {
    if (project) {
      loadCompetitors();
      checkDocExists("product-info", setProductInfoExists);
      checkDocExists("marketing-strategy", setMarketingStrategyExists);
      checkDocExists("competitor-analysis", setCompetitorAnalysisExists);
      checkDocExists("content-strategy", setContentStrategyExists);
      checkDocExists("design-guide", setDesignGuideExists);
    } else {
      setCompetitors([]);
      setProductInfoExists(false);
      setMarketingStrategyExists(false);
      setCompetitorAnalysisExists(false);
      setContentStrategyExists(false);
      setDesignGuideExists(false);
      setCompetitorsLoading(false);
    }
  }, [project?.id, competitorsVersion, loadCompetitors, checkDocExists]);

  async function handleAddCompetitor() {
    const url = newCompetitorUrl.trim();
    if (!url) return;
    try {
      const res = await fetch("/api/project/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        show(data.error || "Failed to add competitor.");
        return;
      }
      const data = await res.json();
      setCompetitors((prev) => [...prev, data.competitor]);
      setNewCompetitorUrl("");
      setAddingCompetitor(false);
    } catch {
      show("Failed to add competitor.");
    }
  }

  async function handleDiscoverCompetitors() {
    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setDiscovering(true);
    log("Looking for real competitors...");
    try {
      const res = await fetch("/api/project/competitors/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: primaryModel, providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to discover competitors"}`);
        show(data.error || "Failed to discover competitors.");
        return;
      }

      const added: { url: string }[] = data.added ?? [];
      if (added.length === 0) {
        log(
          data.usedWebSearch
            ? "No confident competitors found — try adding one manually."
            : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found."
        );
        show("No new competitors found.");
      } else {
        const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
        log(
          `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
        );
        show(`Found ${added.length} competitor${added.length === 1 ? "" : "s"}.`);
        loadCompetitors();
      }
    } catch {
      log("⚠ Couldn't reach the competitor discovery service.");
      show("Failed to discover competitors.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleRemoveCompetitor(id: string) {
    setCompetitors((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/project/competitors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      show("Failed to remove competitor — it may still be saved.");
      loadCompetitors();
    }
  }

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Globe size={15} />} label="Brand" onClick={onToggle} />
        <RailButton icon={<FolderOpen size={15} />} label="Docs" onClick={onToggle} />
        <RailButton icon={<Users size={15} />} label="Comps" onClick={onToggle} />
        <div className="mt-auto pt-2">
          <button
            onClick={onToggle}
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#00ab92] text-[11px] font-semibold text-[#00ab92]"
            title="On-Page Score: 97"
          >
            97
          </button>
          <div className="mt-1 text-center text-[9px] font-medium text-gray-400">SEO</div>
        </div>
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <Layers size={15} className="text-gray-500" />
          Context
        </div>
        <button onClick={onToggle} className="text-gray-400 hover:text-gray-700" title="Collapse">
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="okara-scroll flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="text-[13px] text-gray-400">Loading...</p>
        ) : !project ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
            <Link2 size={18} className="text-gray-300" />
            <p className="text-[13px] font-medium text-gray-700">No project yet</p>
            <p className="text-[12px] text-gray-500">
              Click the project switcher at the top of the dashboard and choose{" "}
              <span className="font-medium">+ New project</span> to link a website — Context,
              Analytics, and every agent will use it from there.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-indigo-400" />
                <span className="text-[13px] font-semibold text-gray-900">{project.name}</span>
              </div>
              <button onClick={() => show("Edit project name — coming soon.")} className="text-gray-400 hover:text-gray-700">
                <Pencil size={13} />
              </button>
            </div>

            {project.category && (
              <span className="mb-3 inline-block rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-500">
                {project.category}
              </span>
            )}

            <div className="mb-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-gray-400">
                <Link2 size={11} /> WEBSITE
              </label>
              <a
                href={project.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 hover:underline"
              >
                {project.url.replace(/^https?:\/\//, "")}
              </a>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => show("Team size & category form — coming soon.")}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                <Plus size={11} /> Add team size &amp; category
              </button>
              <button
                onClick={() => show("Rewriting project description...")}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                <RefreshCw size={11} /> Improve writing quality
              </button>
            </div>

            {project.description && (
              <p className="mb-6 text-[13px] leading-relaxed text-gray-500">{project.description}</p>
            )}
          </>
        )}

        <div className="mb-1 flex w-full items-center justify-between">
          <button
            onClick={() => setDocsExpanded((v) => !v)}
            className="flex-1 text-left text-[11px] font-semibold tracking-wide text-gray-400"
          >
            DOCUMENTS
          </button>
        </div>
        {docsExpanded && (
          <div className="mb-6 divide-y divide-gray-100">
            {DOC_TYPES.map((doc) => {
              const hasContent =
                (doc.docType === "product_info" && productInfoExists) ||
                (doc.docType === "marketing_strategy" && marketingStrategyExists) ||
                (doc.docType === "competitor_analysis" && competitorAnalysisExists) ||
                (doc.docType === "content_strategy" && contentStrategyExists) ||
                (doc.docType === "design_guide" && designGuideExists);
              return (
                <button
                  key={doc.docType}
                  onClick={() => {
                    if (!project) {
                      show("Link a website first — see the project switcher at the top.");
                    } else if (!doc.available) {
                      show(`${doc.name} isn't built yet.`);
                    } else if (doc.docType === "product_info") {
                      setProductInfoOpen(true);
                    } else if (doc.docType === "marketing_strategy") {
                      setMarketingStrategyOpen(true);
                    } else if (doc.docType === "competitor_analysis") {
                      setCompetitorAnalysisOpen(true);
                    } else if (doc.docType === "content_strategy") {
                      setContentStrategyOpen(true);
                    } else if (doc.docType === "design_guide") {
                      setDesignGuideOpen(true);
                    }
                  }}
                  className="flex w-full items-center justify-between py-2.5 text-left text-[13px] text-gray-700 hover:text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    {doc.name}
                    {hasContent && <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />}
                  </span>
                  {!doc.available ? (
                    <span className="text-[11px] text-gray-400">Coming soon</span>
                  ) : (
                    <ChevronRight size={13} className="text-gray-300" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => setCompsExpanded((v) => !v)}
          className="mb-2 flex w-full items-center justify-between"
        >
          <h3 className="text-[11px] font-semibold tracking-wide text-gray-400">COMPETITORS</h3>
          <span className="flex items-center gap-2.5">
            <span
              role="button"
              title="Find competitors automatically"
              onClick={(e) => {
                e.stopPropagation();
                if (!project) {
                  show("Link a website first — see the project switcher at the top.");
                  return;
                }
                if (!discovering) handleDiscoverCompetitors();
              }}
              className={`text-gray-400 hover:text-gray-700 ${discovering ? "pointer-events-none" : ""}`}
            >
              {discovering ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            </span>
            <span
              role="button"
              title="Add a competitor manually"
              onClick={(e) => {
                e.stopPropagation();
                if (!project) {
                  show("Link a website first — see the project switcher at the top.");
                  return;
                }
                setAddingCompetitor((v) => !v);
              }}
              className="text-gray-400 hover:text-gray-700"
            >
              <Plus size={14} />
            </span>
          </span>
        </button>
        {compsExpanded && (
          <>
            {addingCompetitor && (
              <div className="mb-2 flex gap-2">
                <input
                  autoFocus
                  value={newCompetitorUrl}
                  onChange={(e) => setNewCompetitorUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCompetitor()}
                  placeholder="competitor.com"
                  className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
                />
                <button
                  onClick={handleAddCompetitor}
                  className="rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
                >
                  Add
                </button>
              </div>
            )}
            {competitorsLoading ? (
              <p className="text-[12px] text-gray-400">Loading...</p>
            ) : competitors.length === 0 ? (
              <p className="text-[12px] text-gray-400">No competitors added yet.</p>
            ) : (
              <div className="space-y-1.5 text-[13px] text-gray-700">
                {competitors.map((c) => (
                  <div key={c.id} className="group flex items-center justify-between gap-2">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-gray-900 hover:underline"
                    >
                      {c.url.replace(/^https?:\/\//, "")}
                    </a>
                    <button
                      onClick={() => handleRemoveCompetitor(c.id)}
                      className="shrink-0 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 px-4 py-3 text-[11px] text-gray-400">
        What your CMO reads before writing anything — edit any of it, anytime.
      </div>

      {productInfoOpen && (
        <ProductInfoPanel
          onClose={() => {
            setProductInfoOpen(false);
            checkDocExists("product-info", setProductInfoExists);
          }}
        />
      )}
      {marketingStrategyOpen && (
        <MarketingStrategyPanel
          onClose={() => {
            setMarketingStrategyOpen(false);
            checkDocExists("marketing-strategy", setMarketingStrategyExists);
          }}
        />
      )}
      {competitorAnalysisOpen && (
        <CompetitorAnalysisPanel
          onClose={() => {
            setCompetitorAnalysisOpen(false);
            checkDocExists("competitor-analysis", setCompetitorAnalysisExists);
          }}
        />
      )}
      {contentStrategyOpen && (
        <ContentStrategyPanel
          onClose={() => {
            setContentStrategyOpen(false);
            checkDocExists("content-strategy", setContentStrategyExists);
          }}
        />
      )}
      {designGuideOpen && (
        <DesignGuidePanel
          onClose={() => {
            setDesignGuideOpen(false);
            checkDocExists("design-guide", setDesignGuideExists);
          }}
        />
      )}
    </div>
  );
}
