import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
  try {
    const db = getDb();
    const drafts = db.prepare("SELECT * FROM hn_drafts ORDER BY created_at DESC").all();
    return NextResponse.json({ drafts });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
