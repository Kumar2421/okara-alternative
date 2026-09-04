import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
  try {
    const db = getDb();
    const prs = db.prepare("SELECT * FROM github_prs ORDER BY created_at DESC").all();
    return NextResponse.json({ prs });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
