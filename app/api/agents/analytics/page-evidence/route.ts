import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pageUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!pageUrl) {
    return NextResponse.json({ error: "Missing page URL." }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = setting?.value ?? null;
    if (!projectId) {
      return NextResponse.json({ error: "No active project." }, { status: 422 });
    }

    const { data: project } = await db
      .from("projects")
      .select("url")
      .eq("id", projectId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!project?.url) {
      return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
    }

    let projectOrigin: URL;
    let target: URL;
    try {
      projectOrigin = new URL(project.url);
      target = new URL(pageUrl);
    } catch {
      return NextResponse.json({ error: "Invalid project or page URL." }, { status: 400 });
    }

    if (target.protocol !== projectOrigin.protocol || target.hostname !== projectOrigin.hostname) {
      return NextResponse.json(
        { error: "Ranking page must belong to the active project website." },
        { status: 403 }
      );
    }

    try {
      const pageSpeedApiKey = process.env.PAGESPEED_API_KEY || undefined;
      const audit = await new SEOAgent(pageSpeedApiKey).audit(target.toString());

      return NextResponse.json({
        url: audit.url,
        meta: audit.meta,
        headings: audit.headings,
        contentRelevance: audit.contentRelevance,
        technical: {
          status: audit.technical.status,
          redirectCount: audit.technical.redirectCount,
        },
        serverTiming: audit.serverTiming,
        pageSpeed: audit.pageSpeed,
        coreWebVitals: audit.coreWebVitals,
        links: {
          internal: audit.links.filter((link) => link.internal).length,
          external: audit.links.filter((link) => !link.internal).length,
        },
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "No active project." }, { status: 422 });
  }

  const db = getDb();
  const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as
    | { url: string }
    | undefined;

  if (!project?.url) {
    return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
  }

  let projectOrigin: URL;
  let target: URL;
  try {
    projectOrigin = new URL(project.url);
    target = new URL(pageUrl);
  } catch {
    return NextResponse.json({ error: "Invalid project or page URL." }, { status: 400 });
  }

  if (target.protocol !== projectOrigin.protocol || target.hostname !== projectOrigin.hostname) {
    return NextResponse.json(
      { error: "Ranking page must belong to the active project website." },
      { status: 403 }
    );
  }

  try {
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as
      | { value: string }
      | undefined;
    const pageSpeedApiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;
    const audit = await new SEOAgent(pageSpeedApiKey).audit(target.toString());

    return NextResponse.json({
      url: audit.url,
      meta: audit.meta,
      headings: audit.headings,
      contentRelevance: audit.contentRelevance,
      technical: {
        status: audit.technical.status,
        redirectCount: audit.technical.redirectCount,
      },
      serverTiming: audit.serverTiming,
      pageSpeed: audit.pageSpeed,
      coreWebVitals: audit.coreWebVitals,
      links: {
        internal: audit.links.filter((link) => link.internal).length,
        external: audit.links.filter((link) => !link.internal).length,
      },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
