import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkCitations } from "@/lib/domain/geo/GEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;
    if (!projectId) return NextResponse.json({ result: null });

    const { data: row } = await db
      .from("geo_checks")
      .select("payload, checked_at")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle();

    if (!row) return NextResponse.json({ result: null });
    return NextResponse.json({ result: { rows: row.payload, checkedAt: row.checked_at } });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ result: null });

  const db = getDb();
  const row = db.prepare("SELECT payload, checked_at FROM geo_checks WHERE project_id = ?").get(activeId) as
    | { payload: string; checked_at: string }
    | undefined;

  if (!row) return NextResponse.json({ result: null });
  return NextResponse.json({ result: { rows: JSON.parse(row.payload), checkedAt: row.checked_at } });
}

/** // free in platform mode for now — no credit_costs entry yet (checkCitations calls Tavily) */
export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    // Tavily key: same generic BYOK secret store (provider_connections +
    // Vault) reused for the PageSpeed key in the site-crawl/pagespeed route —
    // no dedicated schema table exists for non-LLM API keys.
    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "tavily_api_key")
      .maybeSingle();
    if (!conn?.api_key_secret_id) {
      return NextResponse.json(
        { error: "Connect a Tavily API key in Settings → API Credentials to run a real citation check." },
        { status: 422 }
      );
    }
    const { data: secret, error: secretError } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    if (secretError || !secret) {
      return NextResponse.json(
        { error: "Connect a Tavily API key in Settings → API Credentials to run a real citation check." },
        { status: 422 }
      );
    }
    const tavilyApiKey = secret as string;

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;

    const { data: project } = projectId
      ? await db.from("projects").select("name, category, url").eq("id", projectId).eq("owner_id", user.id).maybeSingle()
      : { data: null };

    if (!projectId || !project || !project.url) {
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
      const rows = await checkCitations(tavilyApiKey, project.name, project.category, domain);
      const now = new Date().toISOString();
      const { error } = await db.from("geo_checks").upsert(
        { user_id: user.id, project_id: projectId, payload: rows, checked_at: now },
        { onConflict: "project_id" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ result: { rows, checkedAt: now } });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const db = getDb();

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  if (!tavilyKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Tavily API key in Settings → API Credentials to run a real citation check." },
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
