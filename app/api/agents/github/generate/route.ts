import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { GitHubAgent } from "@/lib/domain/github/GitHubAgent";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { repo, providerId, model } = body as {
    repo: string;
    providerId?: string;
    model?: string;
  };

  if (!repo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

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

  // Needs a real SEO audit to base the PR on — read the shared project URL,
  // then whatever audit is already stored for it (run one first via the SEO
  // Agent / Analytics tab if none exists yet).
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'project_url'").get() as
    | { value: string }
    | undefined;

  if (!urlRow) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the Context panel first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(urlRow.value) as
    | { payload: string }
    | undefined;

  if (!auditRow) {
    return NextResponse.json(
      { error: "No SEO audit found for your linked site yet. Run one in Analytics → SEO first." },
      { status: 422 }
    );
  }

  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);

  try {
    const agent = new GitHubAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const result = await agent.draftFix({ repo, audit, model });

    if (result.stream) {
      return new NextResponse(result.stream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json({ text: result.text });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
