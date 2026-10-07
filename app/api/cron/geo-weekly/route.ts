import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { runProjectGeo } from "@/lib/domain/geo/geoService";
import { selectDueGeoProjects, utcWeekStart } from "@/lib/domain/geo/dueProjects";
import { lastRunByProject } from "@/lib/domain/geo/geoStoreSupabase";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;
const BUDGET_MS = 50_000;

/**
 * Weekly AI-visibility runs for every project with Search Console connected
 * (platform only, scheduled via vercel.json). Projects already run this week
 * are skipped and the rest go oldest-last-run first, so a time-boxed run cannot
 * starve the same projects every week. Idempotent per day and capped per user
 * (slots are reserved before each call), so a rerun never double-spends.
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

  const targets = (connections ?? []).map((c) => ({ projectId: String(c.project_id), userId: String(c.user_id) }));
  const last = await lastRunByProject(db, targets.map((t) => t.projectId));
  const due = selectDueGeoProjects(targets, last, utcWeekStart(new Date()));
  const deadline = Date.now() + BUDGET_MS;

  const summary = await runWithBudget(
    due,
    async ({ projectId, userId }) => {
      // Never let one project run past the overall deadline; the runner re-checks it before every prompt and call.
      const budgetMs = Math.min(20_000, deadline - Date.now());
      if (budgetMs <= 0) throw new Error("Out of time budget");
      const result = await runProjectGeo({ mode: "platform", db, userId, projectId }, { budgetMs });
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
