import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { ProductInfoGenerator } from "@/lib/domain/documents/ProductInfoGenerator";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

const DOC_TYPE = "product_info";

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

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as
    | { payload: string }
    | undefined;
  if (!auditRow) {
    return NextResponse.json(
      { error: "No crawl data for this site yet. It should have run automatically when the project was created — try refreshing the SEO audit in Analytics." },
      { status: 422 }
    );
  }

  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  try {
    const generator = new ProductInfoGenerator(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const result = await generator.generate({
      projectName: project.name,
      url: project.url,
      bodyText: audit.bodyText ?? "",
      metaTitle: audit.meta.title,
      metaDescription: audit.meta.description,
      model,
    });

    if (!result.stream) {
      // Non-streaming drivers: save immediately, same as the streaming path
      // below just without the client accumulating chunks first.
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
         VALUES (?, ?, 'ready', ?, ?, ?)
         ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, status = 'ready', updated_at = excluded.updated_at`
      ).run(activeId, DOC_TYPE, result.text ?? "", now, now);
      return NextResponse.json({ text: result.text });
    }

    return new NextResponse(result.stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
