import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id: string | undefined = body?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: project, error } = await db
      .from("projects")
      .select("id, url")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

    const { error: upsertError } = await db.from("user_settings").upsert(
      { user_id: user.id, key: "active_project_id", value: project.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  const project = db.prepare("SELECT id, url FROM projects WHERE id = ?").get(id) as
    | { id: string; url: string }
    | undefined;
  if (!project) {
    return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  }

  setActiveProjectId(project.id);

  // project_url stays in sync with whichever project is now active — same
  // mechanism POST /api/project uses on create.
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('project_url', @url)
     ON CONFLICT(key) DO UPDATE SET value = @url`
  ).run({ url: project.url });

  return NextResponse.json({ success: true });
}
