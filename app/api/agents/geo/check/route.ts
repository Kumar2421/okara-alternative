import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkCitations } from "@/lib/domain/geo/GEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ result: null });

  const db = getDb();
  const row = db.prepare("SELECT payload, checked_at FROM geo_checks WHERE project_id = ?").get(activeId) as
    | { payload: string; checked_at: string }
    | undefined;

  if (!row) return NextResponse.json({ result: null });
  return NextResponse.json({ result: { rows: JSON.parse(row.payload), checkedAt: row.checked_at } });
}

export async function POST() {
  const db = getDb();

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  if (!tavilyKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Tavily API key in Settings → LLM Providers to run a real citation check." },
      { status: 422 }
    );
  }

  const activeId = getActiveProjectId();
  const project = activeId
    ? (db.prepare("SELECT name, category, url FROM projects WHERE id = ?").get(activeId) as
        | { name: string; category: string; url: string }
        | undefined)
    : undefined;
  if (!activeId || !project || !project.url) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the project switcher first." },
      { status: 422 }
    );
  }

  let domain: string;
  try {
    domain = new URL(project.url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid project URL." }, { status: 422 });
  }

  try {
    const rows = await checkCitations(tavilyKeyRow.value, project.name, project.category, domain);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO geo_checks (project_id, payload, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`
    ).run(activeId, JSON.stringify(rows), now);

    return NextResponse.json({ result: { rows, checkedAt: now } });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
