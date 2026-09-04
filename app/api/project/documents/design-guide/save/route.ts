import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

const DOC_TYPE = "design_guide";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content: string | undefined = body?.content;

  if (!content || !content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project to save this document against." }, { status: 422 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT created_at FROM project_documents WHERE project_id = ? AND doc_type = ?")
    .get(activeId, DOC_TYPE) as { created_at: string } | undefined;

  db.prepare(
    `INSERT INTO project_documents (project_id, doc_type, status, content, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)
     ON CONFLICT(project_id, doc_type) DO UPDATE SET content = excluded.content, status = 'ready', updated_at = excluded.updated_at`
  ).run(activeId, DOC_TYPE, content, existing?.created_at ?? now, now);

  return NextResponse.json({ success: true });
}
