import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { fetchGA4Report, getSelectedGA4Property } from "@/lib/domain/analytics/googleAnalyticsData";
import { getSelectedGA4Property as getSelectedGA4PropertySupabase } from "@/lib/domain/integrations/integrationStoreSupabase";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { brandTermsFrom } from "@/lib/domain/search/searchIntent";
import { getValidPlatformGoogleToken } from "@/lib/domain/shared/getValidPlatformGoogleToken";
import { resolvePlatformApiKey } from "@/lib/domain/shared/resolvePlatformApiKey";
import { tavilySearchRaw } from "@/lib/domain/shared/webSearchTool";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys";
import { buildReferralReportBody, parseReferralRows, type ReferralResult } from "./aiReferral";
import { resolveGeminiDailyCap } from "./dailyCap";
import { createGeminiGroundedPort, createSimulatedPort, DEFAULT_GEMINI_MODEL, type AnswerPort } from "./engines";
import * as sqliteStore from "./geoStore";
import * as supabaseStore from "./geoStoreSupabase";
import { activePrompts, mergePrompts, suggestPrompts } from "./promptSet";
import { evaluateReadiness, type ReadinessResult } from "./readiness";
import { runGeoPrompts, type RunStore, type RunSummary } from "./runner";
import { MAX_TRACKED_PROMPTS, type AnswerMethod, type GeoPrompt, type GeoRunRow } from "./types";
import { aggregateRuns, compareTrend, dayOf, ratesByDay, type Subject, type Trend } from "./visibility";

export type GeoContext =
  | { mode: "platform"; db: SupabaseClient; userId: string; projectId: string }
  | { mode: "selfhost"; projectId: string };

type ProjectInfo = { name: string; category: string; url: string; domain: string };

const HISTORY_DAYS = 90;

export async function loadProject(ctx: GeoContext): Promise<ProjectInfo | null> {
  let row: { name?: string; category?: string; url?: string } | null | undefined;
  if (ctx.mode === "platform") {
    const { data } = await ctx.db.from("projects").select("name, category, url").eq("id", ctx.projectId).eq("owner_id", ctx.userId).maybeSingle();
    row = data;
  } else {
    row = getDb().prepare("SELECT name, category, url FROM projects WHERE id = ?").get(ctx.projectId) as typeof row;
  }
  if (!row?.url) return null;
  try {
    const domain = new URL(row.url.includes("://") ? row.url : `https://${row.url}`).hostname.replace(/^www\./, "").toLowerCase();
    return { name: row.name ?? domain, category: row.category ?? "", url: row.url, domain };
  } catch {
    return null;
  }
}

async function loadCompetitorDomains(ctx: GeoContext): Promise<string[]> {
  let urls: string[];
  if (ctx.mode === "platform") {
    const { data } = await ctx.db.from("project_competitors").select("url").eq("project_id", ctx.projectId).eq("user_id", ctx.userId);
    urls = (data ?? []).map((r) => String(r.url));
  } else {
    urls = (getDb().prepare("SELECT url FROM project_competitors WHERE project_id = ?").all(ctx.projectId) as { url: string }[]).map((r) => r.url);
  }
  const out: string[] = [];
  for (const u of urls) {
    try {
      const h = new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
      if (!out.includes(h)) out.push(h);
    } catch {
      // skip malformed
    }
  }
  return out.slice(0, 10);
}

type Keys = { gemini?: string; tavily?: string; groq?: string };

async function resolveKeys(ctx: GeoContext): Promise<Keys> {
  if (ctx.mode === "platform") {
    return {
      gemini: await resolvePlatformApiKey(ctx.db, ctx.userId, "gemini_api_key"),
      tavily: await resolvePlatformApiKey(ctx.db, ctx.userId, "tavily_api_key"),
      groq: PLATFORM_PROVIDER_KEYS.groq,
    };
  }
  const db = getDb();
  const setting = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value?.trim() || undefined;
  const groqRow = db.prepare("SELECT api_key FROM provider_connections WHERE provider_id = 'groq'").get() as { api_key: string } | undefined;
  return { gemini: setting("gemini_api_key"), tavily: setting("tavily_api_key"), groq: groqRow?.api_key || undefined };
}

export type GeoCapabilities = {
  geminiAvailable: boolean;
  simulatedAvailable: boolean;
  geminiDailyCap: number | null;
  geminiUsedToday: number;
};

function buildPorts(keys: Keys): AnswerPort[] {
  const ports: AnswerPort[] = [];
  if (keys.gemini) ports.push(createGeminiGroundedPort({ apiKey: keys.gemini, model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL }));
  if (keys.tavily && keys.groq) {
    const tavilyKey = keys.tavily;
    const groqKey = keys.groq;
    const driver = getDriver("groq");
    if (driver) {
      ports.push(
        createSimulatedPort({
          search: (q) => tavilySearchRaw(tavilyKey, q, 6),
          complete: async (system, user) => {
            const result = await driver({
              apiKey: groqKey,
              model: PLATFORM_DEFAULT_MODELS.groq,
              system,
              messages: [{ role: "user", content: user }],
            });
            return result.text ?? "";
          },
        }),
      );
    }
  }
  return ports;
}

function runStoreFor(ctx: GeoContext): RunStore {
  return ctx.mode === "platform" ? supabaseStore.supabaseRunStore(ctx.db, ctx.userId, ctx.projectId) : sqliteStore.sqliteRunStore(getDb(), ctx.projectId);
}

async function listPrompts(ctx: GeoContext): Promise<GeoPrompt[]> {
  return ctx.mode === "platform" ? supabaseStore.listPrompts(ctx.db, ctx.userId, ctx.projectId) : sqliteStore.listPrompts(getDb(), ctx.projectId);
}

export async function savePrompts(ctx: GeoContext, prompts: GeoPrompt[]): Promise<void> {
  if (ctx.mode === "platform") await supabaseStore.replacePrompts(ctx.db, ctx.userId, ctx.projectId, prompts);
  else sqliteStore.replacePrompts(getDb(), ctx.projectId, prompts);
}

async function listRuns(ctx: GeoContext, now = new Date()): Promise<GeoRunRow[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  return ctx.mode === "platform" ? supabaseStore.listRuns(ctx.db, ctx.userId, ctx.projectId, since) : sqliteStore.listRuns(getDb(), ctx.projectId, since);
}

/** Top Search Console queries from the latest snapshot, turned into buyer questions. Empty if GSC has no snapshot yet. */
export async function suggestFromSearchConsole(ctx: GeoContext, project: ProjectInfo): Promise<string[]> {
  const latest = ctx.mode === "platform" ? await getLatestSnapshotSupabase(ctx.db, ctx.userId, ctx.projectId) : getLatestSnapshot(getDb(), ctx.projectId);
  if (!latest) return [];
  return suggestPrompts(latest.payload.windows.d28.queries, brandTermsFrom(project.name, project.url));
}

/** Seed prompts from Search Console the first time only, so user edits are never overwritten. */
export async function ensurePrompts(ctx: GeoContext, project: ProjectInfo): Promise<GeoPrompt[]> {
  const existing = await listPrompts(ctx);
  if (existing.length > 0) return existing;
  const suggestions = await suggestFromSearchConsole(ctx, project);
  if (suggestions.length === 0) return [];
  const merged = mergePrompts([], suggestions);
  await savePrompts(ctx, merged);
  return merged;
}

export async function runProjectGeo(ctx: GeoContext, opts: { budgetMs?: number; now?: Date } = {}): Promise<RunSummary & { noEngines?: boolean; noPrompts?: boolean }> {
  const project = await loadProject(ctx);
  if (!project) throw new Error("No project website linked yet. Add one in the project switcher first.");
  const prompts = activePrompts(await ensurePrompts(ctx, project));
  if (prompts.length === 0) return { ran: 0, skippedAlreadyDone: 0, skippedCap: 0, skippedBudget: 0, failed: [], noPrompts: true };
  const ports = buildPorts(await resolveKeys(ctx));
  if (ports.length === 0) return { ran: 0, skippedAlreadyDone: 0, skippedCap: 0, skippedBudget: 0, failed: [], noEngines: true };

  const subject: Subject = { brand: project.name, domain: project.domain, competitors: await loadCompetitorDomains(ctx) };
  const now = opts.now;
  return runGeoPrompts({
    prompts,
    ports,
    subject,
    store: runStoreFor(ctx),
    caps: { "gemini-grounded": resolveGeminiDailyCap(ctx.mode === "platform", process.env.GEMINI_DAILY_CAP) },
    budgetMs: opts.budgetMs,
    now: now ? () => now : undefined,
  });
}

export type PromptRow = {
  prompt: string;
  source: "gsc" | "manual";
  active: boolean;
  methods: Array<{
    method: AnswerMethod;
    runs: number;
    mentionRate: number;
    citedRate: number;
    trend: Trend;
    previousRate: number | null;
    /** Competitors named in at least one run of the latest day. */
    competitors: string[];
    lastRunAt: string;
  }>;
};

export type GeoOverview = {
  project: { name: string; domain: string };
  prompts: PromptRow[];
  capabilities: GeoCapabilities;
  lastRunAt: string | null;
};

export async function getOverview(ctx: GeoContext, now = new Date()): Promise<GeoOverview | null> {
  const project = await loadProject(ctx);
  if (!project) return null;
  const [prompts, runs, keys, store] = await Promise.all([ensurePrompts(ctx, project), listRuns(ctx, now), resolveKeys(ctx), Promise.resolve(runStoreFor(ctx))]);
  const usedToday = keys.gemini ? await store.countMethodRunsToday("gemini-grounded", dayOf(now.toISOString())) : 0;

  const rows: PromptRow[] = prompts.map((p) => {
    const own = runs.filter((r) => r.prompt === p.prompt);
    const methods = (["gemini-grounded", "simulated"] as const)
      .filter((m) => own.some((r) => r.method === m))
      .map((method) => {
        const latestDay = ratesByDay(own, method)[0].date;
        const latestRuns = own.filter((r) => r.method === method && dayOf(r.runAt) === latestDay);
        const agg = aggregateRuns(latestRuns, method);
        const t = compareTrend(own, method);
        return {
          method,
          runs: agg.runs,
          mentionRate: agg.mentionRate,
          citedRate: agg.citedRate,
          trend: t.trend,
          previousRate: t.previous,
          competitors: Object.keys(agg.competitorRates),
          lastRunAt: latestRuns.map((r) => r.runAt).sort().reverse()[0],
        };
      });
    return { prompt: p.prompt, source: p.source, active: p.active, methods };
  });

  return {
    project: { name: project.name, domain: project.domain },
    prompts: rows,
    capabilities: {
      geminiAvailable: Boolean(keys.gemini),
      simulatedAvailable: Boolean(keys.tavily && keys.groq),
      geminiDailyCap: resolveGeminiDailyCap(ctx.mode === "platform", process.env.GEMINI_DAILY_CAP),
      geminiUsedToday: usedToday,
    },
    lastRunAt: runs.length > 0 ? runs[0].runAt : null,
  };
}

export async function getPromptHistory(ctx: GeoContext, prompt: string): Promise<GeoRunRow[]> {
  return (await listRuns(ctx)).filter((r) => r.prompt === prompt);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "MarloBot/1.0 (+readiness check)" } });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

export async function checkReadiness(domain: string): Promise<ReadinessResult> {
  const base = `https://${domain}`;
  const [robotsTxt, llmsTxt, homepageHtml, sitemapXml] = await Promise.all([
    fetchText(`${base}/robots.txt`),
    fetchText(`${base}/llms.txt`),
    fetchText(`${base}/`),
    fetchText(`${base}/sitemap.xml`),
  ]);
  const sitemapFound = /^\s*sitemap\s*:/im.test(robotsTxt ?? "") || Boolean(sitemapXml && /<(urlset|sitemapindex)[\s>]/i.test(sitemapXml));
  // A soft-404 HTML page at /llms.txt is not a real llms.txt.
  const llms = llmsTxt && !/^\s*<(!doctype|html)/i.test(llmsTxt) ? llmsTxt : null;
  return evaluateReadiness({ robotsTxt, llmsTxt: llms, sitemapFound, homepageHtml });
}

export type ReferralView = (ReferralResult & { range: { startDate: string; endDate: string } }) | { notConnected: true };

export async function getAiReferrals(ctx: GeoContext, now = new Date()): Promise<ReferralView> {
  const property = ctx.mode === "platform" ? await getSelectedGA4PropertySupabase(ctx.db, ctx.userId, ctx.projectId) : getSelectedGA4Property(ctx.projectId);
  if (!property) return { notConnected: true };
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 27 * 86_400_000).toISOString().slice(0, 10);
  const body = buildReferralReportBody(start, end);
  let report: { rows?: unknown[] };
  if (ctx.mode === "platform") {
    const token = await getValidPlatformGoogleToken(ctx.db, ctx.userId, ctx.projectId);
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property.id}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA4 report failed: HTTP ${res.status}`);
    report = await res.json();
  } else {
    report = await fetchGA4Report(property.id, body);
  }
  return { ...parseReferralRows(report.rows as Parameters<typeof parseReferralRows>[0]), range: { startDate: start, endDate: end } };
}

export const listSavedPrompts = listPrompts;
export { MAX_TRACKED_PROMPTS };
