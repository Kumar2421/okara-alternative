import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { captureProjectSnapshotPlatform } from "@/lib/domain/search/captureForProject";
import { selectDueProjects } from "@/lib/domain/search/dueProjects";
import { isoDate } from "@/lib/domain/search/searchSnapshot";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Hobby caps cron functions at 60s. Stop a little short of it and resume on
// the next run rather than being killed mid-project.
export const maxDuration = 60;
const BUDGET_MS = 45_000;

/**
 * Daily Search Console snapshot for every project with GSC connected —
 * platform-only, scheduled via vercel.json. Idempotent: a project that
 * already has today's snapshot is skipped, so extra invocations (or a rerun
 * after hitting the time budget) only do the remaining work.
 */
export async function GET(req: NextRequest) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const today = isoDate(new Date());

  const { data: connections, error } = await db
    .from("integration_connections")
    .select("project_id, user_id")
    .eq("provider", "gsc")
    .not("project_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: done } = await db.from("search_snapshots").select("project_id").eq("snapshot_date", today);

  const due = selectDueProjects(
    (connections ?? []).map((c) => ({ projectId: String(c.project_id), userId: String(c.user_id) })),
    new Set((done ?? []).map((row) => String(row.project_id))),
  );

  const summary = await runWithBudget(
    due,
    async ({ projectId, userId }) => {
      await captureProjectSnapshotPlatform(db, userId, projectId);
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
