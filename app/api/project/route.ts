import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId, setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { checkUrlReachable } from "@/lib/domain/shared/checkUrlReachable";

/**
 * Real multi-project support: `projects` can hold many rows, `active_project_id`
 * in the settings table (see getActiveProjectId.ts) says which one is live.
 * GET returns both the active project and the full list, so the header's
 * project switcher can render real saved projects, not just one.
 */

type ProjectRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const db = getDb();
  const activeId = getActiveProjectId();

  const active = activeId
    ? (db.prepare("SELECT * FROM projects WHERE id = ?").get(activeId) as ProjectRow | undefined)
    : undefined;

  const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];

  return NextResponse.json({ project: active ?? null, projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  let url = body.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let validated: URL;
  try {
    validated = assertPublicHttpUrl(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  // Reject an unreachable URL before it's ever saved — there's no
  // delete-project capability yet, so a typo'd/dead URL saved here would sit
  // there permanently instead of surfacing a clear error at creation time.
  const { reachable, status } = await checkUrlReachable(validated.toString());
  if (!reachable) {
    return NextResponse.json(
      {
        error: status
          ? `This URL responded with HTTP ${status} — check it's correct and publicly accessible before adding it.`
          : "Couldn't reach this URL — check it's correct, publicly accessible, and not behind a login.",
      },
      { status: 422 }
    );
  }

  const name = body.name.trim();
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  const db = getDb();
  const now = new Date().toISOString();
  const id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    `INSERT INTO projects (id, name, category, description, url, created_at, updated_at)
     VALUES (@id, @name, @category, @description, @url, @createdAt, @updatedAt)`
  ).run({ id, name, category, description, url, createdAt: now, updatedAt: now });

  setActiveProjectId(id);

  // Keep the shared project_url setting in sync — every agent route (SEO,
  // GitHub, etc.) already reads project_url from the settings table, so this
  // is what actually makes "add a link, everything else fetches fresh" true
  // without rewriting every agent route's lookup key.
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('project_url', @url)
     ON CONFLICT(key) DO UPDATE SET value = @url`
  ).run({ url });

  return NextResponse.json({ project: { id, name, category, description, url, created_at: now, updated_at: now } });
}
