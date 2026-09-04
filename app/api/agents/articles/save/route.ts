import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id, topic, keywords, brandVoice, content } = body as {
    id: string;
    topic: string;
    keywords: string;
    brandVoice: string;
    content: string;
  };

  if (!id || !topic || !keywords || !brandVoice || !content) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const db = getDb();
    const createdAt = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO articles (id, topic, keywords, brandVoice, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        keywords = excluded.keywords,
        brandVoice = excluded.brandVoice,
        content = excluded.content
    `).run(id, topic, keywords, brandVoice, content, createdAt);

    return NextResponse.json({ success: true, id });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const articles = db.prepare("SELECT * FROM articles ORDER BY created_at DESC").all();
    return NextResponse.json({ articles });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
