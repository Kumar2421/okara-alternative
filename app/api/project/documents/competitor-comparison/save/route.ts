import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { content } = body ?? {};

  if (!content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  try {
    const projectId = getActiveProjectId();
    if (!projectId) {
      return NextResponse.json({ error: "No active project" }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO project_documents (project_id, doc_type, content, status, created_at, updated_at)
      VALUES (?, 'competitor_comparison', ?, 'ready', datetime('now'), datetime('now'))
      ON CONFLICT(project_id, doc_type) DO UPDATE SET
        content = excluded.content,
        status = 'ready',
        updated_at = datetime('now')
    `).run(projectId, content);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save" },
      { status: 500 }
    );
  }
}
