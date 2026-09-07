import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver, providerSupportsTools } from "@/lib/llm";
import { CompetitorAnalysisGenerator, fetchCompetitorSnippet } from "@/lib/domain/documents/CompetitorAnalysisGenerator";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { appendFooterToStream, NO_TAVILY_FOOTER } from "@/lib/domain/shared/appendFooterToStream";
import { lookupEntityDescription } from "@/lib/domain/shared/knowledgeGraph";

const DOC_TYPE = "competitor_analysis";

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ document: null });

  const db = getDb();
  const row = db
    .prepare("SELECT status, content, updated_at FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(activeId, DOC_TYPE) as { status: string; content: string; updated_at: string } | undefined;

  return NextResponse.json({ document: row ?? null });
}

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

  const competitorRows = db
    .prepare("SELECT url FROM project_competitors WHERE project_id = ?")
    .all(activeId) as { url: string }[];

  if (competitorRows.length === 0) {
    return NextResponse.json(
      { error: "No competitors added yet. Add at least one in the Context panel's Competitors section first." },
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

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  const tavilyApiKey = tavilyKeyRow?.value && providerSupportsTools(providerId) ? tavilyKeyRow.value : undefined;

  const googleKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  const googleApiKey = googleKeyRow?.value || undefined;

  try {
    // Real fetch per competitor (title + meta description) — bounded and
    // parallel, not a full SEO audit per competitor.
    const competitors = await Promise.all(
      competitorRows.map(async (c) => {
        const snippet = await fetchCompetitorSnippet(c.url);
        const kgDescription = googleApiKey
          ? (await lookupEntityDescription(googleApiKey, snippet.title).catch(() => null)) ?? undefined
          : undefined;
        return { ...snippet, kgDescription };
      })
    );

    const generator = new CompetitorAnalysisGenerator(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const result = await generator.generate({
      projectName: project.name,
      url: project.url,
      bodyText: audit.bodyText ?? "",
      metaTitle: audit.meta.title,
      metaDescription: audit.meta.description,
      competitors,
      model,
      tavilyApiKey,
    });

    if (!result.stream) {
      const text = (result.text ?? "") + (tavilyApiKey ? "" : NO_TAVILY_FOOTER);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
         VALUES (?, ?, 'ready', ?, ?, ?)
         ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, status = 'ready', updated_at = excluded.updated_at`
      ).run(activeId, DOC_TYPE, text, now, now);
      return NextResponse.json({ text });
    }

    const outStream = tavilyApiKey ? result.stream : appendFooterToStream(result.stream, NO_TAVILY_FOOTER);
    return new NextResponse(outStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
