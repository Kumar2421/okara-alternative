import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id: string | undefined = body?.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  const project = db.prepare("SELECT id, url FROM projects WHERE id = ?").get(id) as
    | { id: string; url: string }
    | undefined;
  if (!project) {
    return NextResponse.json({ error: "No project with that id" }, { status: 404 });
  }

  setActiveProjectId(project.id);

  // project_url stays in sync with whichever project is now active — same
  // mechanism POST /api/project uses on create.
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('project_url', @url)
     ON CONFLICT(key) DO UPDATE SET value = @url`
  ).run({ url: project.url });

  return NextResponse.json({ success: true });
}
