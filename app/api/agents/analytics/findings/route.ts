import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listProjectFindings, upsertFinding } from "@/lib/domain/findings/findingStore";
import {
  listProjectFindings as listProjectFindingsSupabase,
  upsertFinding as upsertFindingSupabase,
} from "@/lib/domain/findings/findingStoreSupabase";
import { deriveSearchFinding } from "@/lib/domain/findings/findingRules";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Vercel: crawl + PageSpeed calls can run past the 10s default.
export const maxDuration = 60;

export async function GET() {
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
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const findings = await listProjectFindingsSupabase(db, user.id, projectId);
    return NextResponse.json({ findings });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const findings = listProjectFindings(projectId);
  return NextResponse.json({ findings });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const pageUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!query || !pageUrl) return NextResponse.json({ error: "Query and ranking page URL are required." }, { status: 400 });

  const evidenceFromBody = {
    query,
    clicks: typeof body?.clicks === "number" ? body.clicks : null,
    impressions: typeof body?.impressions === "number" ? body.impressions : null,
    ctr: typeof body?.ctr === "number" ? body.ctr : null,
    position: typeof body?.position === "number" ? body.position : null,
    score: typeof body?.score === "number" ? body.score : null,
  };

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
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });

    let projectOrigin: URL;
    let target: URL;
    try {
      projectOrigin = new URL(project.url);
      target = new URL(pageUrl);
    } catch {
      return NextResponse.json({ error: "Invalid project or page URL." }, { status: 400 });
    }
    if (target.protocol !== projectOrigin.protocol || target.hostname !== projectOrigin.hostname) {
      return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
    }

    try {
      const { data: conn } = await db
        .from("provider_connections")
        .select("api_key_secret_id")
        .eq("user_id", user.id)
        .eq("provider_id", "pagespeed_api_key")
        .maybeSingle();
      let pageSpeedApiKey: string | undefined = process.env.PAGESPEED_API_KEY || undefined;
      if (conn?.api_key_secret_id) {
        const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
        if (secret) pageSpeedApiKey = secret as string;
      }

      const audit = await new SEOAgent(pageSpeedApiKey).audit(target.toString());
      const finding = deriveSearchFinding(audit);
      if (!finding) {
        return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
      }

      const saved = await upsertFindingSupabase(db, user.id, {
        projectId,
        source: "search-console",
        category: "search-visibility",
        severity: finding.severity,
        entityType: "query",
        entityId: query,
        url: target.toString(),
        evidence: {
          ...evidenceFromBody,
          page: {
            meta: audit.meta,
            headings: audit.headings,
            contentRelevance: audit.contentRelevance,
            technical: { status: audit.technical.status, redirectCount: audit.technical.redirectCount },
            serverTiming: audit.serverTiming,
            links: {
              internal: audit.links.filter((link) => link.internal).length,
              external: audit.links.filter((link) => !link.internal).length,
            },
          },
        },
        recommendation: finding.recommendation,
      });

      return NextResponse.json({ finding: saved });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

  const db = getDb();
  const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string } | undefined;
  if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });

  let projectOrigin: URL;
  let target: URL;
  try {
    projectOrigin = new URL(project.url);
    target = new URL(pageUrl);
  } catch {
    return NextResponse.json({ error: "Invalid project or page URL." }, { status: 400 });
  }

  if (target.protocol !== projectOrigin.protocol || target.hostname !== projectOrigin.hostname) {
    return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
  }

  try {
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
    const pageSpeedApiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;
    const audit = await new SEOAgent(pageSpeedApiKey).audit(target.toString());
    const finding = deriveSearchFinding(audit);
    if (!finding) {
      return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
    }

    const saved = upsertFinding({
      projectId,
      source: "search-console",
      category: "search-visibility",
      severity: finding.severity,
      entityType: "query",
      entityId: query,
      url: target.toString(),
      evidence: {
        ...evidenceFromBody,
        page: {
          meta: audit.meta,
          headings: audit.headings,
          contentRelevance: audit.contentRelevance,
          technical: { status: audit.technical.status, redirectCount: audit.technical.redirectCount },
          serverTiming: audit.serverTiming,
          links: {
            internal: audit.links.filter((link) => link.internal).length,
            external: audit.links.filter((link) => !link.internal).length,
          },
        },
      },
      recommendation: finding.recommendation,
    });

    return NextResponse.json({ finding: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
