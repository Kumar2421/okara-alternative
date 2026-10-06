import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listFindings } from "@/lib/domain/findings/findingService";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import { buildOpportunities } from "@/lib/domain/search/searchOpportunities";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { rankNextActions } from "@/lib/domain/search/nextActions.ts";
import { weekChanges } from "@/lib/domain/search/weekChanges.ts";
import { readOutcomes } from "@/lib/domain/search/outcomeService";
import { platformOutcomePorts, selfHostOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { listProjectActions } from "@/lib/domain/actions/actionStore";
import { listProjectActions as listProjectActionsSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/**
 * Search overview combining:
 * - Summary stats (clicks, impressions, avg position)
 * - Week changes (new/lost/improved/declined searches)
 * - Next actions to take
 * - Completed actions / "Your fixes"
 */
export async function GET() {
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
      const latest = await getLatestSnapshotSupabase(db, user.id, projectId);

      if (!latest) {
        return NextResponse.json({ snapshot: null, gscNotConnected: true });
      }

      const opportunities = buildOpportunities(latest.payload);
      const findings = await listFindings(supabaseFindingRepository(db, user.id), projectId);
      const actions = await listProjectActionsSupabase(db, user.id, projectId);
      const ports = { platformOutcomePorts: await platformOutcomePorts(db, user.id, projectId, project?.url ?? null) };

      const outcomes = await readOutcomes(ports.platformOutcomePorts, actions);
      const completed = outcomes.filter((a) => a.status === "completed");

      return NextResponse.json({
        snapshot: { capturedAt: latest.capturedAt, snapshotDate: latest.snapshotDate },
        stats: {
          d28: latest.payload.windows.d28,
          prev28: latest.payload.windows.prev28,
        },
        weekChanges: weekChanges(latest.payload.windows.d7, null, 5),
        nextActions: rankNextActions(findings, opportunities, 3),
        yourFixes: completed.slice(0, 3),
      });
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const db = getDb();
    const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;
    const latest = getLatestSnapshot(db, projectId);

    if (!latest) {
      return NextResponse.json({ snapshot: null, gscNotConnected: true });
    }

    const opportunities = buildOpportunities(latest.payload);
    const findings = await listFindings(sqliteFindingRepository(), projectId);
    const actions = listProjectActions(projectId);
    const ports = selfHostOutcomePorts(projectId, project?.url ?? null);

    const outcomes = await readOutcomes(ports, actions);
    const completed = outcomes.filter((a) => a.status === "completed");

    return NextResponse.json({
      snapshot: { capturedAt: latest.capturedAt, snapshotDate: latest.snapshotDate },
      stats: {
        d28: latest.payload.windows.d28,
        prev28: latest.payload.windows.prev28,
      },
      weekChanges: weekChanges(latest.payload.windows.d7, null, 5),
      nextActions: rankNextActions(findings, opportunities, 3),
      yourFixes: completed.slice(0, 3),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
