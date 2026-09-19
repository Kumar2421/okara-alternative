import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getProjectFinding,
  listProjectFindings,
  refreshFinding,
  updateFindingStatus,
  upsertFinding,
} from "@/lib/domain/findings/findingStore";
import {
  getProjectFinding as getProjectFindingSupabase,
  listProjectFindings as listProjectFindingsSupabase,
  refreshFinding as refreshFindingSupabase,
  updateFindingStatus as updateFindingStatusSupabase,
  upsertFinding as upsertFindingSupabase,
} from "@/lib/domain/findings/findingStoreSupabase";
import { deriveSearchFinding } from "@/lib/domain/findings/findingRules";
import { applyRecheck, getFinding, listFindings, transitionFinding } from "@/lib/domain/findings/findingService";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

function auditEvidence(audit: Awaited<ReturnType<SEOAgent["audit"]>>, metrics: Record<string, unknown>) {
  return {
    ...metrics,
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
  };
}

function projectPageUrl(projectUrl: string, pageUrl: string): URL | null {
  try {
    const project = new URL(projectUrl);
    const target = new URL(pageUrl);
    if (target.protocol !== project.protocol || target.hostname !== project.hostname) return null;
    return target;
  } catch {
    return null;
  }
}

async function runRecheck(finding: { url: string | null; evidence: Record<string, unknown> }, pageSpeedApiKey: string | undefined) {
  if (!finding.url) throw new Error("Finding has no ranking page URL.");
  const metrics = {
    query: finding.evidence.query ?? null,
    clicks: finding.evidence.clicks ?? null,
    impressions: finding.evidence.impressions ?? null,
    ctr: finding.evidence.ctr ?? null,
    position: finding.evidence.position ?? null,
    score: finding.evidence.score ?? null,
  };
  const audit = await new SEOAgent(pageSpeedApiKey).audit(finding.url);
  const rule = deriveSearchFinding(audit);
  return {
    audit,
    rule,
    evidence: auditEvidence(audit, metrics),
  };
}

// Same BYOK-then-platform-key pattern as seo/audit/route.ts — a connected
// PageSpeed key (provider_connections, Vault-backed) wins over the shared
// server key.
async function resolvePlatformPageSpeedKey(db: ReturnType<typeof createServiceClient>, userId: string): Promise<string | undefined> {
  const { data: conn } = await db
    .from("provider_connections")
    .select("api_key_secret_id")
    .eq("user_id", userId)
    .eq("provider_id", "pagespeed_api_key")
    .maybeSingle();
  if (conn?.api_key_secret_id) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    if (secret) return secret as string;
  }
  return process.env.PAGESPEED_API_KEY || undefined;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    if (id) {
      const finding = await getFinding({ get: (p, findingId) => getProjectFindingSupabase(db, user.id, p, findingId), list: (p) => listProjectFindingsSupabase(db, user.id, p), transition: (p, findingId, nextStatus) => updateFindingStatusSupabase(db, user.id, p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFindingSupabase(db, user.id, p, findingId, input) }, projectId, id);
      return finding ? NextResponse.json({ finding }) : NextResponse.json({ error: "Finding not found." }, { status: 404 });
    }
    return NextResponse.json({ findings: await listFindings({ get: (p, findingId) => getProjectFindingSupabase(db, user.id, p, findingId), list: (p) => listProjectFindingsSupabase(db, user.id, p), transition: (p, findingId, nextStatus) => updateFindingStatusSupabase(db, user.id, p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFindingSupabase(db, user.id, p, findingId, input) }, projectId) });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  if (id) {
    const finding = await getFinding({ get: (p, findingId) => getProjectFinding(p, findingId), list: (p) => listProjectFindings(p), transition: (p, findingId, nextStatus) => updateFindingStatus(p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFinding(p, findingId, input) }, projectId, id);
    return finding ? NextResponse.json({ finding }) : NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }
  return NextResponse.json({ findings: await listFindings({ get: (p, findingId) => getProjectFinding(p, findingId), list: (p) => listProjectFindings(p), transition: (p, findingId, nextStatus) => updateFindingStatus(p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFinding(p, findingId, input) }, projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const pageUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!query || !pageUrl) return NextResponse.json({ error: "Query and ranking page URL are required." }, { status: 400 });

  const metrics = {
    query,
    clicks: typeof body?.clicks === "number" ? body.clicks : null,
    impressions: typeof body?.impressions === "number" ? body.impressions : null,
    ctr: typeof body?.ctr === "number" ? body.ctr : null,
    position: typeof body?.position === "number" ? body.position : null,
    score: typeof body?.score === "number" ? body.score : null,
  };

  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
      if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
      const target = projectPageUrl(project.url, pageUrl);
      if (!target) return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
      const audit = await new SEOAgent(await resolvePlatformPageSpeedKey(db, user.id)).audit(target.toString());
      const rule = deriveSearchFinding(audit);
      if (!rule) return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
      const finding = await upsertFindingSupabase(db, user.id, {
        projectId, source: "search-console", category: "search-visibility", severity: rule.severity,
        entityType: "query", entityId: query, url: target.toString(),
        evidence: auditEvidence(audit, metrics), recommendation: rule.recommendation,
      });
      return NextResponse.json({ finding });
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const db = getDb();
    const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string } | undefined;
    if (!project?.url) return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
    const target = projectPageUrl(project.url, pageUrl);
    if (!target) return NextResponse.json({ error: "Ranking page must belong to the active project website." }, { status: 403 });
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
    const audit = await new SEOAgent(stored?.value || process.env.PAGESPEED_API_KEY || undefined).audit(target.toString());
    const rule = deriveSearchFinding(audit);
    if (!rule) return NextResponse.json({ finding: null, message: "No actionable issue found on this ranking page." });
    const finding = upsertFinding({
      projectId, source: "search-console", category: "search-visibility", severity: rule.severity,
      entityType: "query", entityId: query, url: target.toString(),
      evidence: auditEvidence(audit, metrics), recommendation: rule.recommendation,
    });
    return NextResponse.json({ finding });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id) return NextResponse.json({ error: "Finding id is required." }, { status: 400 });

  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const finding = await getFinding({ get: (p, findingId) => getProjectFindingSupabase(db, user.id, p, findingId), list: (p) => listProjectFindingsSupabase(db, user.id, p), transition: (p, findingId, nextStatus) => updateFindingStatusSupabase(db, user.id, p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFindingSupabase(db, user.id, p, findingId, input) }, projectId, id);
      if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

      if (action === "recheck") {
        const result = await runRecheck(finding, await resolvePlatformPageSpeedKey(db, user.id));
        const nextStatus = result.rule ? "failed" : "verified";
        const updated = await applyRecheck({
          get: (p, findingId) => getProjectFindingSupabase(db, user.id, p, findingId),
          list: (p) => listProjectFindingsSupabase(db, user.id, p),
          transition: (p, findingId, nextStatus) => updateFindingStatusSupabase(db, user.id, p, findingId, nextStatus),
          refresh: (p, findingId, input) => refreshFindingSupabase(db, user.id, p, findingId, input),
        }, projectId, id, {
          severity: result.rule?.severity ?? finding.severity,
          evidence: result.evidence,
          recommendation: result.rule?.recommendation ?? "Issue no longer detected. Keep the page under observation and re-check if it changes.",
          issueDetected: Boolean(result.rule),
        });
        return NextResponse.json({ finding: updated, verification: { status: nextStatus, changed: nextStatus === "verified" } });
      }

      if (!["new", "acknowledged", "fixing", "fixed", "verified", "failed"].includes(status)) {
        return NextResponse.json({ error: "Invalid finding status." }, { status: 400 });
      }
      const updated = await transitionFinding({ get: (p, findingId) => getProjectFindingSupabase(db, user.id, p, findingId), list: (p) => listProjectFindingsSupabase(db, user.id, p), transition: (p, findingId, nextStatus) => updateFindingStatusSupabase(db, user.id, p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFindingSupabase(db, user.id, p, findingId, input) }, projectId, id, status as typeof finding.status);
      return NextResponse.json({ finding: updated });
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const finding = await getFinding({ get: (p, findingId) => getProjectFinding(p, findingId), list: (p) => listProjectFindings(p), transition: (p, findingId, nextStatus) => updateFindingStatus(p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFinding(p, findingId, input) }, projectId, id);
    if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

    if (action === "recheck") {
      const stored = getDb().prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as { value: string } | undefined;
      const result = await runRecheck(finding, stored?.value || process.env.PAGESPEED_API_KEY || undefined);
      const nextStatus = result.rule ? "failed" : "verified";
      const updated = await applyRecheck({
        get: (p, findingId) => getProjectFinding(p, findingId),
        list: (p) => listProjectFindings(p),
        transition: (p, findingId, nextStatus) => updateFindingStatus(p, findingId, nextStatus),
        refresh: (p, findingId, input) => refreshFinding(p, findingId, input),
      }, projectId, id, {
        severity: result.rule?.severity ?? finding.severity,
        evidence: result.evidence,
        recommendation: result.rule?.recommendation ?? "Issue no longer detected. Keep the page under observation and re-check if it changes.",
        issueDetected: Boolean(result.rule),
      });
      return NextResponse.json({ finding: updated, verification: { status: nextStatus, changed: nextStatus === "verified" } });
    }

    if (!["new", "acknowledged", "fixing", "fixed", "verified", "failed"].includes(status)) {
      return NextResponse.json({ error: "Invalid finding status." }, { status: 400 });
    }
    return NextResponse.json({ finding: await transitionFinding({ get: (p, findingId) => getProjectFinding(p, findingId), list: (p) => listProjectFindings(p), transition: (p, findingId, nextStatus) => updateFindingStatus(p, findingId, nextStatus), refresh: (p, findingId, input) => refreshFinding(p, findingId, input) }, projectId, id, status as typeof finding.status) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.startsWith("Invalid finding status transition") ? 409 : 502;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
