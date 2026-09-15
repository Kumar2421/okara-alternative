import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { resolveCodeFixContext, findFinding } from "@/lib/domain/codefix/resolveContext";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const issueId: string | undefined = body?.issueId;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 });
  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected. Connect a provider in Settings → LLM Providers." }, { status: 422 });
  }

  try {
    const ctx = resolveCodeFixContext();
    const finding = findFinding(ctx.projectUrl, issueId);

    const db = getDb();
    const existing = db.prepare("SELECT status, pr_url FROM code_fixes WHERE project_id = ? AND issue_id = ?").get(ctx.projectId, issueId) as
      | { status: string; pr_url: string | null }
      | undefined;
    if (existing && (existing.status === "pr_open" || existing.status === "merged")) {
      return NextResponse.json({ error: `Already has a real PR for this: ${existing.pr_url}`, prUrl: existing.pr_url }, { status: 409 });
    }
    if (existing && existing.status === "rejected") {
      return NextResponse.json({ error: "This fix was previously rejected — won't auto-retry. Delete that record to try again." }, { status: 409 });
    }

    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
    }
    const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
      | { api_key: string; base_url: string | null }
      | undefined;
    if (!connRow) {
      return NextResponse.json({ error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` }, { status: 422 });
    }

    const provider = getCodeFixProvider("contents-api", driver, connRow.api_key, model, connRow.base_url ?? undefined);
    const proposed = await provider.proposeFix(finding, ctx);

    return NextResponse.json({ finding, proposed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a fix." }, { status: 500 });
  }
}
