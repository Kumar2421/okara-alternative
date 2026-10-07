import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { isAuthorizedCron, runWithBudget } from "@/lib/jobs/jobRunner";
import { captureProjectSnapshotPlatform } from "@/lib/domain/search/captureForProject";
import { selectDueProjects } from "@/lib/domain/search/dueProjects";
import { isoDate } from "@/lib/domain/search/searchSnapshot";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { runNotificationJob, type NotificationJobSummary } from "@/lib/domain/notifications/job";
import { supabaseNotificationStore } from "@/lib/domain/notifications/notificationStoreSupabase";
import { platformNotificationSource } from "@/lib/domain/notifications/platformSource";
import { emailLinksFor, notificationConfig } from "@/lib/domain/notifications/runtime";

// Hobby caps cron functions at 60s. Stop a little short of it and resume on
// the next run rather than being killed mid-project.
export const maxDuration = 60;
const BUDGET_MS = 45_000;
// Notifications run after the snapshots (they read the fresh ones) in whatever
// is left of the 60s function limit. Hobby allows only two crons, so this
// rides along instead of being a third.
const NOTIFY_DEADLINE_MS = 57_000;
const NOTIFY_MIN_BUDGET_MS = 2_000;

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

  const startedAt = Date.now();
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

  // Failures here never fail the snapshot run, and never carry secrets into the response.
  let notifications: Pick<NotificationJobSummary, "users" | "skipped" | "created" | "emailed" | "emailFailed"> & { failed: number } | { error: string };
  const notifyBudget = NOTIFY_DEADLINE_MS - (Date.now() - startedAt);
  if (notifyBudget < NOTIFY_MIN_BUDGET_MS) {
    notifications = { error: "No time left; will run tomorrow." };
  } else {
    try {
      const config = notificationConfig();
      const result = await runNotificationJob({
        source: platformNotificationSource(db),
        store: supabaseNotificationStore(db),
        sender: config.sender,
        linksFor: (userId) => emailLinksFor(userId, config),
        budgetMs: notifyBudget,
        log: (message) => console.warn(`[notifications] ${message}`),
      });
      notifications = { users: result.users, skipped: result.skipped, created: result.created, emailed: result.emailed, emailFailed: result.emailFailed, failed: result.failed.length };
    } catch (err) {
      console.warn("[notifications] job failed:", err instanceof Error ? err.message : "unknown error");
      notifications = { error: "Notification job failed." };
    }
  }

  return NextResponse.json({
    notifications,
    due: due.length,
    processed: summary.processed,
    skipped: summary.skipped,
    failed: summary.failed.map(({ item, error: message }) => ({ projectId: item.projectId, error: message })),
  });
}
