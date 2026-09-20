import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { FEATURES } from "@/lib/features";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const DATASETS = [
  "project_documents",
  "project_competitors",
  "seo_audits",
  "link_checks",
  "geo_checks",
  "site_crawls",
  "traffic_checks",
  "findings",
  "code_fixes",
  "leads",
] as const;

export async function GET(request: NextRequest) {
  const requestedProjectId = request.nextUrl.searchParams.get("projectId");
  const result = await getAuthenticatedProjectContext(requestedProjectId);
  if ("response" in result) return result.response;

  const { context } = result;
  const data: Record<string, unknown[]> = {};

  if (FEATURES.PLATFORM_MODE && context.supabase) {
    for (const table of DATASETS) {
      const { data: rows, error } = await context.supabase
        .from(table)
        .select("*")
        .eq("project_id", context.projectId)
        .order("created_at", { ascending: false });
      if (error) {
        return NextResponse.json({ error: `Failed to load ${table}: ${error.message}` }, { status: 500 });
      }
      data[table] = rows ?? [];
    }
  } else {
    const db = getDb();
    for (const table of DATASETS) {
      try {
        data[table] = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY created_at DESC`).all(context.projectId) as unknown[];
      } catch {
        data[table] = [];
      }
    }
  }

  return NextResponse.json(
    { project: context.project, projectId: context.projectId, data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
