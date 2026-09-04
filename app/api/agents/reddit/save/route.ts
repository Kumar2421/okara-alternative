import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { opportunities } = (body ?? {}) as { opportunities?: unknown };

  if (!opportunities || !Array.isArray(opportunities)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
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
  try {
    const db = getDb();
    const opportunities = db.prepare("SELECT * FROM reddit_opportunities ORDER BY created_at DESC").all();
    return NextResponse.json({ opportunities });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
