import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";
import { FEATURES } from "@/lib/features";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Each table's real "most recent" timestamp column — not all of them are
// created_at. link_checks/geo_checks/site_crawls/traffic_checks are
// single-row-per-project snapshots keyed on checked_at, and findings tracks
// first_seen/last_seen instead. Ordering every table by a literal
// "created_at" (as this route used to) 500s on the five that don't have it.
const DATASETS: Record<string, string> = {
  project_documents: "created_at",
  project_competitors: "created_at",
  seo_audits: "created_at",
  link_checks: "checked_at",
  geo_checks: "checked_at",
  site_crawls: "checked_at",
  traffic_checks: "checked_at",
  findings: "last_seen",
  code_fixes: "created_at",
  leads: "created_at",
};

export async function GET(request: NextRequest) {
  const requestedProjectId = request.nextUrl.searchParams.get("projectId");
  const result = await getAuthenticatedProjectContext(requestedProjectId);
  if ("response" in result) return result.response;

  const { context } = result;
  const data: Record<string, unknown[]> = {};

  if (FEATURES.PLATFORM_MODE && context.supabase) {
    for (const [table, orderColumn] of Object.entries(DATASETS)) {
      const { data: rows, error } = await context.supabase
        .from(table)
        .select("*")
        .eq("project_id", context.projectId)
        .order(orderColumn, { ascending: false });
      if (error) {
        return NextResponse.json({ error: `Failed to load ${table}: ${error.message}` }, { status: 500 });
      }
      data[table] = rows ?? [];
    }
  } else {
    const db = getDb();
    for (const [table, orderColumn] of Object.entries(DATASETS)) {
      try {
        data[table] = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${orderColumn} DESC`).all(context.projectId) as unknown[];
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
