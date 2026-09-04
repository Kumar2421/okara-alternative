import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
  try {
    const db = getDb();
    const drafts = db.prepare("SELECT * FROM x_drafts ORDER BY created_at DESC").all();
    return NextResponse.json({ drafts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
