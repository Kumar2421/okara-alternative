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

  const { id, topic, keywords, brandVoice, content, title } = body as {
    id: string;
    topic: string;
    keywords: string;
    brandVoice: string;
    content: string;
    title?: string;
  };

  if (!id || !topic || !keywords || !brandVoice || !content) {
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
      return NextResponse.json({ error: "No active project to save this article against." }, { status: 422 });
    }

    // Note: Postgres schema uses snake_case `brand_voice` (vs SQLite's `brandVoice`).
    const { data, error } = await db
      .from("articles")
      .insert({
        user_id: user.id,
        project_id: projectId,
        topic,
        keywords,
        brand_voice: brandVoice,
        content,
        title: title ?? topic,
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
      INSERT INTO articles (id, topic, keywords, brandVoice, content, title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        keywords = excluded.keywords,
        brandVoice = excluded.brandVoice,
        content = excluded.content,
        title = excluded.title
    `).run(id, topic, keywords, brandVoice, content, title ?? topic, createdAt);

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
    const { data: articles, error } = await db
      .from("articles")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ articles: articles ?? [] });
  }

  try {
    const db = getDb();
    const articles = db.prepare("SELECT * FROM articles ORDER BY created_at DESC").all();
    return NextResponse.json({ articles });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
