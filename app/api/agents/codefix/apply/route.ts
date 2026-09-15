import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { resolveCodeFixContext, findFinding } from "@/lib/domain/codefix/resolveContext";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import type { ProposedFix } from "@/lib/domain/codefix/types";

/** Takes the exact ProposedFix the user reviewed on /propose — never
 * re-generates it here, so what gets committed is exactly what was shown. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const issueId: string | undefined = body?.issueId;
  const proposed: ProposedFix | undefined = body?.proposed;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!issueId || !proposed) return NextResponse.json({ error: "issueId and proposed are required" }, { status: 400 });
  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected." }, { status: 422 });
  }

  try {
    const ctx = resolveCodeFixContext();
    const finding = findFinding(ctx.projectUrl, issueId);

    const driver = getDriver(providerId);
    if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });

    const db = getDb();
    const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
      | { api_key: string; base_url: string | null }
      | undefined;
    if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

    const provider = getCodeFixProvider("contents-api", driver, connRow.api_key, model, connRow.base_url ?? undefined);
    const { prUrl, branch } = await provider.applyFix(proposed, ctx, finding);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO code_fixes (id, project_id, issue_id, status, pr_url, file_path, created_at, updated_at)
       VALUES (@id, @projectId, @issueId, 'pr_open', @prUrl, @filePath, @now, @now)
       ON CONFLICT(project_id, issue_id) DO UPDATE SET
         status = 'pr_open', pr_url = excluded.pr_url, file_path = excluded.file_path, updated_at = excluded.updated_at`
    ).run({
      id: `fix_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      projectId: ctx.projectId,
      issueId,
      prUrl,
      filePath: proposed.filePath,
      now,
    });

    return NextResponse.json({ prUrl, branch });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to open PR." }, { status: 500 });
  }
}
