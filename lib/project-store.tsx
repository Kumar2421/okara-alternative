"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useTerminalLog } from "./terminal-log-store";
import { useProviders, findProviderForModel } from "./providers-store";

export type ActiveProject = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  updated_at: string;
};

type Ctx = {
  project: ActiveProject | null;
  /** All saved projects (real multi-project — see /api/project), newest
   * first. Powers the project switcher's dropdown list. */
  projects: ActiveProject[];
  loading: boolean;
  /** Creates a NEW project, makes it active, saves it, triggers a real SEO
   * crawl of the URL, and logs real progress lines to the shared terminal
   * log — same flow whether called from the top project switcher or
   * anywhere else. */
  createProject: (input: { name: string; url: string; category?: string; description?: string }) => Promise<void>;
  /** Switches which saved project is active — Context, Analytics, and every
   * agent immediately start reading this one's data instead. */
  switchProject: (id: string) => Promise<void>;
  /** Real edit — name/category/description/url. A URL change is
   * re-validated server-side the same way project creation is. */
  updateProject: (id: string, input: { name?: string; category?: string; description?: string; url?: string }) => Promise<void>;
  /** Real delete — wipes every table scoped to this project (documents,
   * competitors, cached checks, leads) server-side. If this was the active
   * project, the most-recently-updated remaining one becomes active. */
  deleteProject: (id: string) => Promise<void>;
  /** Bumped after auto-discovery adds competitors post-creation — ContextPanel
   * watches this to refresh its competitor list without polling. */
  competitorsVersion: number;
  /** Bumped once the automatic post-creation SEO crawl actually finishes.
   * `project.url` changes the instant the project is created — well before
   * the crawl (awaited afterward) completes — so anything that refetches
   * only on `project.url` (e.g. AnalyticsPanel) would fetch too early and
   * see no audit yet, with no signal telling it to try again. This is that
   * signal. */
  auditVersion: number;
};

/** Runs right after a successful crawl during project creation — real
 * competitor discovery (see CompetitorDiscoveryAgent), gated by the Settings
 * toggle (default on) and requiring a connected model. Never throws: a
 * failure here shouldn't block the rest of project setup, it just logs and
 * moves on — competitors can always be found/added manually afterward. */
async function maybeDiscoverCompetitors(
  projectId: string,
  log: (text: string) => void,
  primaryModel: string | null,
  onAdded: () => void
): Promise<boolean> {
  try {
    const settingsRes = await fetch("/api/settings");
    const settingsData = await settingsRes.json();
    const toggle = settingsData.settings?.find((s: { key: string; value: string }) => s.key === "auto_discover_competitors");
    if (toggle?.value === "0") return false;

    if (!primaryModel) {
      log("Skipping competitor discovery — connect a model in Settings to enable it.");
      return false;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) return false;

    log("Looking for real competitors...");
    // Explicit projectId — this runs as a background continuation after
    // creation's crawl, which can take a while. Without pinning the target
    // here, a project switch/creation that happens to land in the meantime
    // would make the route's getActiveProjectId() resolve to whichever
    // project is active BY THE TIME this call reaches the server, silently
    // attaching these competitors to the wrong project.
    const res = await fetch("/api/project/competitors/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: primaryModel, providerId, projectId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log(`Couldn't auto-discover competitors (${err.error ?? "unknown error"}) — add them manually in the Context panel.`);
      return false;
    }

    const data = await res.json();
    const added: { url: string }[] = data.added ?? [];
    if (added.length === 0) {
      log(
        data.usedWebSearch
          ? "No confident competitors found yet — add some manually in the Context panel."
          : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found. Add some manually, or connect Tavily in Settings for deeper discovery."
      );
      return false;
    }

    const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
    log(
      `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
    );
    onAdded();
    return true;
  } catch {
    log("Couldn't reach the competitor discovery service — add competitors manually in the Context panel.");
    return false;
  }
}

/** Same stream → accumulate → POST /save shape as DocumentPanel.tsx's
 * handleGenerate — every /api/project/documents/<doc>/route.ts POST always
 * streams (see e.g. ProductInfoGenerator.generate's stream: true), so
 * nothing is persisted until whoever reads the stream saves it, exactly
 * like a user manually clicking "Generate" in the Context panel would.
 * Runs sequentially by design (not Promise.all): several docs are
 * grounded in an earlier one (Marketing Strategy reads Product Info,
 * Content Strategy reads all three, Design Guide reads Marketing
 * Strategy) — see each Generator's own comments — so generating them out
 * of order would silently produce weaker, ungrounded documents. */
async function generateAndSaveDocument(
  apiPath: string,
  title: string,
  model: string,
  providerId: string,
  log: (text: string) => void
): Promise<boolean> {
  const base = `/api/project/documents/${apiPath}`;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, providerId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      log(`Couldn't auto-generate ${title} (${data.error ?? "unknown error"}) — generate it manually in the Context panel.`);
      return false;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let finalContent = "";
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        finalContent += decoder.decode(value, { stream: true });
      }
    }

    if (!finalContent) return false;

    await fetch(`${base}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: finalContent }),
    });
    log(`${title} ready.`);
    return true;
  } catch {
    log(`Couldn't auto-generate ${title} — generate it manually in the Context panel.`);
    return false;
  }
}

/** Runs right after a new project's crawl + competitor discovery finish —
 * generates every Context document a user would otherwise have to click
 * "Generate" for one by one (see ContextPanel.tsx's DOCUMENTS list). Same
 * grounding order the manual flow relies on: Product Info first, then
 * Marketing Strategy (reads Product Info), then Competitor Analysis (only
 * if at least one competitor exists — the route 422s otherwise, matching
 * the manual "Add a competitor first" gate), then Content Strategy (reads
 * all three), then Design Guide (reads Marketing Strategy). Each step is
 * independent of the others failing — one document erroring (e.g. a
 * transient LLM timeout) shouldn't block the rest from being generated. */
async function autoGenerateContextDocuments(
  primaryModel: string | null,
  hasCompetitors: boolean,
  log: (text: string) => void,
  logDone: (text: string) => void
): Promise<void> {
  if (!primaryModel) {
    log("Skipping auto-generated context documents — connect a model in Settings to enable it.");
    return;
  }
  const providerId = findProviderForModel(primaryModel);
  if (!providerId) return;

  log("Writing your Context documents — Product Information, Marketing Strategy, Content Strategy, and Design Guide...");
  await generateAndSaveDocument("product-info", "Product Information", primaryModel, providerId, log);
  await generateAndSaveDocument("marketing-strategy", "Marketing Strategy", primaryModel, providerId, log);
  if (hasCompetitors) {
    await generateAndSaveDocument("competitor-analysis", "Competitor Analysis", primaryModel, providerId, log);
  } else {
    log("Skipping Competitor Analysis — no competitors found or added yet.");
  }
  await generateAndSaveDocument("content-strategy", "Content Strategy", primaryModel, providerId, log);
  await generateAndSaveDocument("design-guide", "Design Guide", primaryModel, providerId, log);
  logDone("Context documents ready — review and edit anytime in the Context panel.");
}

const ProjectCtx = createContext<Ctx | null>(null);

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

export default function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [projects, setProjects] = useState<ActiveProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [competitorsVersion, setCompetitorsVersion] = useState(0);
  const [auditVersion, setAuditVersion] = useState(0);
  const { log, logDone } = useTerminalLog();
  const { primaryModel } = useProviders();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/project");
      const data = await res.json();
      setProject(data.project);
      setProjects(data.projects ?? []);
    } catch {
      // backend unreachable — leave project as-is, UI shows empty/setup state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProject = useCallback(
    async (input: { name: string; url: string; category?: string; description?: string }) => {
      const displayUrl = input.url.replace(/^https?:\/\//, "");
      log(`Setting up ${input.name}...`);
      log(`Let me take a look at ${displayUrl}...`);

      const res = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log(`⚠ ${err.error ?? "Failed to save project"}`);
        throw new Error(err.error ?? "Failed to save project");
      }

      const data = await res.json();
      setProject(data.project);
      setProjects((prev) => [data.project, ...prev.filter((p) => p.id !== data.project.id)]);

      log("Starting my deep dive — crawling your pages for SEO, content, and growth signals.");

      let crawlSucceeded = false;
      try {
        const auditRes = await fetch("/api/agents/seo/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: data.project.url }),
        });

        if (auditRes.ok) {
          crawlSucceeded = true;
          setAuditVersion((v) => v + 1);
          const audit = await auditRes.json();
          log(
            audit.meta?.title
              ? `Found it: "${audit.meta.title}". Context, Analytics, and agents now have real data to work from.`
              : "Crawled the site. Context, Analytics, and agents now have real data to work from."
          );
        } else {
          const err = await auditRes.json().catch(() => ({}));
          log(`Couldn't fully crawl the site (${err.error ?? "unknown error"}) — agents will still use the URL directly.`);
        }
      } catch {
        log("Couldn't reach the crawl service — agents will still use the URL directly.");
      }

      if (crawlSucceeded) {
        const providerId = primaryModel ? findProviderForModel(primaryModel) : null;
        if (primaryModel && providerId) {
          try {
            log("Writing a real description from what's actually on the page...");
            const descRes = await fetch(`/api/project/${data.project.id}/generate-description`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: primaryModel, providerId }),
            });
            if (descRes.ok) {
              const { description } = await descRes.json();
              setProject((prev) => (prev && prev.id === data.project.id ? { ...prev, description } : prev));
              setProjects((prev) => prev.map((p) => (p.id === data.project.id ? { ...p, description } : p)));
              logDone(`Description: "${description}"`);
            }
          } catch {
            // non-fatal — description stays blank, editable manually in Settings → Websites
          }
        }

        const hasCompetitors = await maybeDiscoverCompetitors(
          data.project.id,
          log,
          primaryModel,
          () => setCompetitorsVersion((v) => v + 1)
        );
        await autoGenerateContextDocuments(primaryModel, hasCompetitors, log, logDone);
      }

      logDone("Done!");
    },
    [log, logDone, primaryModel]
  );

  const switchProject = useCallback(
    async (id: string) => {
      const target = projects.find((p) => p.id === id);
      if (target) log(`Switching to ${target.name}...`);

      const res = await fetch("/api/project/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        log(`⚠ ${err.error ?? "Failed to switch project"}`);
        throw new Error(err.error ?? "Failed to switch project");
      }

      await refresh();
      if (target) logDone(`Now working on ${target.name}.`);
    },
    [projects, log, logDone, refresh]
  );

  const updateProject = useCallback(
    async (id: string, input: { name?: string; category?: string; description?: string; url?: string }) => {
      const res = await fetch(`/api/project/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update project");
      }
      await refresh();
    },
    [refresh]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const target = projects.find((p) => p.id === id);
      const res = await fetch(`/api/project/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to delete project");
      }
      if (target) log(`Deleted ${target.name} and all its data.`);
      await refresh();
    },
    [projects, log, refresh]
  );

  return (
    <ProjectCtx.Provider
      value={{ project, projects, loading, createProject, switchProject, updateProject, deleteProject, competitorsVersion, auditVersion }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}
