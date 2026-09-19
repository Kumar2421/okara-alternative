import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { opportunities } = (body ?? {}) as { opportunities?: unknown };

  if (!opportunities || !Array.isArray(opportunities)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
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
      return NextResponse.json({ error: "No active project to save these opportunities against." }, { status: 422 });
    }

    const rows = (opportunities as Record<string, string>[]).map((op) => {
      if (!op.subreddit || !op.title || !op.body || !op.reply_draft) {
        throw new Error("Each opportunity requires subreddit, title, body, and reply_draft");
      }
      return {
        user_id: user.id,
        project_id: projectId,
        subreddit: op.subreddit,
        title: op.title,
        body: op.body,
        reply_draft: op.reply_draft,
        status: op.status || "draft",
        created_at: new Date().toISOString(),
      };
    });

    const { data, error } = await db.from("reddit_opportunities").insert(rows).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, count: data?.length ?? 0 });
  }

  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO reddit_opportunities (id, subreddit, title, body, reply_draft, status, created_at)
      VALUES (@id, @subreddit, @title, @body, @reply_draft, @status, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        reply_draft = excluded.reply_draft,
        status = excluded.status
    `);

    const createdAt = new Date().toISOString();
    const runMany = db.transaction((ops: Record<string, string>[]) => {
      for (const op of ops) {
        if (!op.id || !op.subreddit || !op.title || !op.body || !op.reply_draft) {
          throw new Error("Each opportunity requires id, subreddit, title, body, and reply_draft");
        }
        insert.run({
          id: op.id,
          subreddit: op.subreddit,
          title: op.title,
          body: op.body,
          reply_draft: op.reply_draft,
          status: op.status || "draft",
          created_at: createdAt,
        });
      }
    });

    runMany(opportunities as Record<string, string>[]);

    return NextResponse.json({ success: true, count: opportunities.length });
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
    const { data: opportunities, error } = await db
      .from("reddit_opportunities")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ opportunities: opportunities ?? [] });
  }

  try {
    const db = getDb();
    const opportunities = db.prepare("SELECT * FROM reddit_opportunities ORDER BY created_at DESC").all();
    return NextResponse.json({ opportunities });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
