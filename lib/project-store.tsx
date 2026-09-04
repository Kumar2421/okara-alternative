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
  /** Bumped after auto-discovery adds competitors post-creation — ContextPanel
   * watches this to refresh its competitor list without polling. */
  competitorsVersion: number;
};

/** Runs right after a successful crawl during project creation — real
 * competitor discovery (see CompetitorDiscoveryAgent), gated by the Settings
 * toggle (default on) and requiring a connected model. Never throws: a
 * failure here shouldn't block the rest of project setup, it just logs and
 * moves on — competitors can always be found/added manually afterward. */
async function maybeDiscoverCompetitors(
  log: (text: string) => void,
  primaryModel: string | null,
  onAdded: () => void
): Promise<void> {
  try {
    const settingsRes = await fetch("/api/settings");
    const settingsData = await settingsRes.json();
    const toggle = settingsData.settings?.find((s: { key: string; value: string }) => s.key === "auto_discover_competitors");
    if (toggle?.value === "0") return;

    if (!primaryModel) {
      log("Skipping competitor discovery — connect a model in Settings to enable it.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) return;

    log("Looking for real competitors...");
    const res = await fetch("/api/project/competitors/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: primaryModel, providerId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log(`Couldn't auto-discover competitors (${err.error ?? "unknown error"}) — add them manually in the Context panel.`);
      return;
    }

    const data = await res.json();
    const added: { url: string }[] = data.added ?? [];
    if (added.length === 0) {
      log(
        data.usedWebSearch
          ? "No confident competitors found yet — add some manually in the Context panel."
          : "No Tavily key connected, so I only had existing site data to go on — no confident competitors found. Add some manually, or connect Tavily in Settings for deeper discovery."
      );
      return;
    }

    const names = added.map((a) => a.url.replace(/^https?:\/\//, "")).join(", ");
    log(
      `${data.usedWebSearch ? "Searched the web and found" : "Based on your site's own content, found"} ${added.length} real competitor${added.length === 1 ? "" : "s"}: ${names}.`
    );
    onAdded();
  } catch {
    log("Couldn't reach the competitor discovery service — add competitors manually in the Context panel.");
  }
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
        await maybeDiscoverCompetitors(log, primaryModel, () => setCompetitorsVersion((v) => v + 1));
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

  return (
    <ProjectCtx.Provider value={{ project, projects, loading, createProject, switchProject, competitorsVersion }}>
      {children}
    </ProjectCtx.Provider>
  );
}
