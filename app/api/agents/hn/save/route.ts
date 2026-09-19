import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id, title, body: contentBody, status } = body as {
    id: string;
    title: string;
    body: string;
    status: string;
  };

  if (!id || !title || !contentBody || !status) {
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
      .from("hn_drafts")
      .insert({
        user_id: user.id,
        project_id: projectId,
        title,
        body: contentBody,
        status,
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
      INSERT INTO hn_drafts (id, title, body, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        status = excluded.status
    `).run(id, title, contentBody, status, createdAt);

    return NextResponse.json({ success: true, id });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: drafts, error } = await db
      .from("hn_drafts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ drafts: drafts ?? [] });
  }

  try {
    const db = getDb();
    const drafts = db.prepare("SELECT * FROM hn_drafts ORDER BY created_at DESC").all();
    return NextResponse.json({ drafts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
