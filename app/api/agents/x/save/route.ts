import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { id, topic, content, status } = (body ?? {}) as {
    id?: string;
    topic?: string;
    content?: string;
    status?: string;
  };

  if (!topic || !content) {
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
      return NextResponse.json({ error: "No active project to save this draft against." }, { status: 422 });
    }

    const { data, error } = await db
      .from("x_drafts")
      .insert({
        user_id: user.id,
        project_id: projectId,
        topic,
        body: content,
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
      INSERT INTO x_drafts (id, topic, body, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        status = excluded.status
    `).run(id || `x_${Date.now()}`, topic, content, status || "draft", createdAt);

    return NextResponse.json({ success: true, id: id || `x_${Date.now()}` });
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
    const { data: drafts, error } = await db
      .from("x_drafts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ drafts: drafts ?? [] });
  }

  try {
    const db = getDb();
    const drafts = db.prepare("SELECT * FROM x_drafts ORDER BY created_at DESC").all();
    return NextResponse.json({ drafts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
