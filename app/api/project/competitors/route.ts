import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ competitors: [] });

  const db = getDb();
  const rows = db
    .prepare("SELECT id, url, created_at FROM project_competitors WHERE project_id = ? ORDER BY created_at ASC")
    .all(activeId);

  return NextResponse.json({ competitors: rows });
}

export async function POST(req: NextRequest) {
  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  const body = await req.json().catch(() => null);
  let url: string | undefined = body?.url;
  if (!url || !url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const db = getDb();
  const id = `comp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    "INSERT INTO project_competitors (id, project_id, url, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, activeId, url, new Date().toISOString());

  return NextResponse.json({ competitor: { id, url } });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM project_competitors WHERE id = ?").run(id);

  return NextResponse.json({ success: true });
}
