import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

const DOC_TYPE = "content_strategy";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content: string | undefined = body?.content;

  if (!content || !content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value;
    if (!activeId) {
      return NextResponse.json({ error: "No active project to save this document against." }, { status: 422 });
    }

    const now = new Date().toISOString();
    const { data: existing } = await db
      .from("project_documents")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .eq("doc_type", DOC_TYPE)
      .maybeSingle();

    const { error } = await db.from("project_documents").upsert(
      {
        user_id: user.id,
        project_id: activeId,
        doc_type: DOC_TYPE,
        status: "ready",
        content,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      },
      { onConflict: "project_id,doc_type" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
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
