import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { CompetitorDiscoveryAgent } from "@/lib/domain/documents/CompetitorDiscoveryAgent";
import { fetchCompetitorSnippet } from "@/lib/domain/documents/CompetitorAnalysisGenerator";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

/** Real automatic competitor discovery — an LLM proposes candidates (web-search-
 * grounded when Tavily is connected, context-only otherwise), then every
 * candidate is verified by an actual fetch before being saved. See
 * CompetitorDiscoveryAgent for why the no-Tavily fallback is still safe to
 * ship: a wrong guess just fails the fetch check and gets dropped. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;

  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  }

  const db = getDb();

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  const project = activeId
    ? (db.prepare("SELECT name, url FROM projects WHERE id = ?").get(activeId) as
        | { name: string; url: string }
        | undefined)
    : undefined;
  if (!activeId || !project || !project.url) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the project switcher first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as
    | { payload: string }
    | undefined;
  if (!auditRow) {
    return NextResponse.json(
      { error: "No crawl data for this site yet. Try refreshing the SEO audit in Analytics." },
      { status: 422 }
    );
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  const groundingDocs = db
    .prepare(
      "SELECT doc_type, content FROM project_documents WHERE project_id = ? AND doc_type IN ('product_info', 'marketing_strategy')"
    )
    .all(activeId) as { doc_type: string; content: string }[];
  const productInfo = groundingDocs.find((d) => d.doc_type === "product_info")?.content;
  const marketingStrategy = groundingDocs.find((d) => d.doc_type === "marketing_strategy")?.content;

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  // Only pass the key through when this provider's driver actually implements
  // tool-calling — otherwise the system prompt would claim search access the
  // model never really gets.
  const tavilyApiKey = tavilyKeyRow?.value && providerSupportsTools(providerId) ? tavilyKeyRow.value : undefined;

  try {
    const agent = new CompetitorDiscoveryAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const { candidates, usedWebSearch } = await agent.discover({
      projectName: project.name,
      url: project.url,
      bodyText: audit.bodyText ?? "",
      metaTitle: audit.meta.title,
      metaDescription: audit.meta.description,
      productInfo,
      marketingStrategy,
      model,
      tavilyApiKey,
    });

    if (candidates.length === 0) {
      return NextResponse.json({ added: [], usedWebSearch, note: "No confident competitor candidates found." });
    }

    // Real verification, same crawl used by Competitor Analysis — a
    // candidate that doesn't resolve is dropped, not saved as fact.
    const verified = await Promise.all(
      candidates.map(async (c) => ({ ...c, snippet: await fetchCompetitorSnippet(`https://${c.domain}`) }))
    );
    const reachable = verified.filter((v) => v.snippet.title !== "(couldn't fetch)");

    const existingRows = db
      .prepare("SELECT url FROM project_competitors WHERE project_id = ?")
      .all(activeId) as { url: string }[];
    const existingHosts = new Set(
      existingRows.map((r) => r.url.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase())
    );

    const now = new Date().toISOString();
    const added: { id: string; url: string; reason: string }[] = [];
    for (const c of reachable) {
      if (existingHosts.has(c.domain)) continue;
      const id = `comp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const url = `https://${c.domain}`;
      db.prepare("INSERT INTO project_competitors (id, project_id, url, created_at) VALUES (?, ?, ?, ?)").run(
        id,
        activeId,
        url,
        now
      );
      added.push({ id, url, reason: c.reason });
    }

    return NextResponse.json({ added, usedWebSearch, proposed: candidates.length, verified: reachable.length });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
