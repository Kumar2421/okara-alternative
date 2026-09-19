import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId, setActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { checkUrlReachable } from "@/lib/domain/shared/checkUrlReachable";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

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
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projects, error } = await db
      .from("projects")
      .select("id, name, category, description, url, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = setting?.value;
    const active = activeId ? (projects ?? []).find((p) => p.id === activeId) ?? null : null;

    return NextResponse.json({ project: active, projects: projects ?? [] });
  }

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

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const now = new Date().toISOString();

    const { data: inserted, error } = await db
      .from("projects")
      .insert({ owner_id: user.id, name, category, description, url, created_at: now, updated_at: now })
      .select("id, name, category, description, url, created_at, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { error: settingError } = await db.from("user_settings").upsert(
      { user_id: user.id, key: "active_project_id", value: inserted.id, updated_at: now },
      { onConflict: "user_id,key" }
    );
    if (settingError) return NextResponse.json({ error: settingError.message }, { status: 500 });

    // Self-host also mirrors the active project's url into a shared
    // `project_url` setting so every agent route can do one cheap lookup.
    // In platform mode, agent routes resolve the active project through
    // getActiveProjectContextSupabase instead — no equivalent setting needed.
    return NextResponse.json({ project: inserted });
  }

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
