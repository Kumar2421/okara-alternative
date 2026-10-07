import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { runProjectGeo } from "@/lib/domain/geo/geoService";
import { selectDueProjects } from "@/lib/domain/search/dueProjects";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;
const BUDGET_MS = 50_000;

/**
 * Weekly AI-visibility runs for every project with Search Console connected
 * (platform only, scheduled via vercel.json). Idempotent: runs already stored
 * today count toward each prompt's three, so a rerun after the time budget
 * only does the remaining work and never double-spends the Gemini daily cap.
 */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: connections, error } = await db
    .from("integration_connections")
    .select("project_id, user_id")
    .eq("provider", "gsc")
    .not("project_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = selectDueProjects((connections ?? []).map((c) => ({ projectId: String(c.project_id), userId: String(c.user_id) })), new Set());

  const summary = await runWithBudget(
    due,
    async ({ projectId, userId }) => {
      const result = await runProjectGeo({ mode: "platform", db, userId, projectId }, { budgetMs: 20_000 });
      if (result.failed.length > 0 && result.ran === 0) throw new Error(result.failed[0].error);
    },
    { budgetMs: BUDGET_MS },
  );

  return NextResponse.json({
    due: due.length,
    processed: summary.processed,
    skipped: summary.skipped,
    failed: summary.failed.map(({ item, error: message }) => ({ projectId: item.projectId, error: message })),
  });
}
