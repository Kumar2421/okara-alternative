import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { id, repo, title, description, diffSummary, status } = (body ?? {}) as {
    id?: string;
    repo?: string;
    title?: string;
    description?: string;
    diffSummary?: string;
    status?: string;
  };

  if (!repo || !title || !description) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projSetting?.value;
    if (!projectId) {
      return NextResponse.json({ error: "No active project to save this PR draft against." }, { status: 422 });
    }

    const { data, error } = await db
      .from("github_prs")
      .insert({
        user_id: user.id,
        project_id: projectId,
        repo,
        title,
        description,
        diff_summary: diffSummary || "",
        status: status || "draft",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, id: data.id });
  }

  try {
    const db = getDb();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO github_prs (id, repo, title, description, diff_summary, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        diff_summary = excluded.diff_summary,
        status = excluded.status
    `).run(id || `pr_${Date.now()}`, repo, title, description, diffSummary || "", status || "draft", createdAt);

    return NextResponse.json({ success: true, id: id || `pr_${Date.now()}` });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: prs, error } = await db
      .from("github_prs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ prs: prs ?? [] });
  }

  try {
    const db = getDb();
    const prs = db.prepare("SELECT * FROM github_prs ORDER BY created_at DESC").all();
    return NextResponse.json({ prs });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
