import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";

type ProjectRow = { id: string; name: string; url: string };

/**
 * Real, narrow LLM job — one or two sentences describing the product,
 * grounded only in the real crawl (title/meta description/body text) just
 * done during creation. Never invents features not evidenced on the page.
 * Called right after project creation's crawl succeeds, same place
 * competitor discovery already runs from.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected." }, { status: 422 });
  }

  const db = getDb();
  const project = db.prepare("SELECT id, name, url FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as { payload: string } | undefined;
  if (!auditRow) {
    return NextResponse.json({ error: "No crawl data for this project yet." }, { status: 422 });
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
    | { api_key: string; base_url: string | null }
    | undefined;
  if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

  const system = `You write a short, factual one-to-two-sentence product description from real crawled page content. Ground it only in what's actually there — never invent features, pricing, or claims the page doesn't make. Output the description text only, nothing else (no quotes, no preamble).`;
  const prompt = `Product: ${project.name} (${project.url})
Meta title: ${audit.meta.title || "(none found)"}
Meta description: ${audit.meta.description || "(none found)"}
Crawled page text: """${(audit.bodyText || "").slice(0, 2000) || "(none extracted)"}"""`;

  try {
    const result = await driver({
      apiKey: connRow.api_key,
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      baseUrl: connRow.base_url ?? undefined,
    });
    const description = (result.text ?? "").trim();
    if (!description) throw new Error("Model returned an empty description.");

    db.prepare("UPDATE projects SET description = ?, updated_at = ? WHERE id = ?").run(description, new Date().toISOString(), id);
    return NextResponse.json({ description });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate a description." }, { status: 500 });
  }
}
