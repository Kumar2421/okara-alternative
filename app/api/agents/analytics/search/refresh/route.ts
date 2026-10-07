import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runPlatformDailyProposals, runSelfHostDailyProposals } from "@/lib/domain/actions/dailyProposalPorts";
import { captureProjectSnapshotPlatform, captureProjectSnapshotSelfHost } from "@/lib/domain/search/captureForProject";
import { countSnapshots, getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import {
  countSnapshots as countSnapshotsSupabase,
  getLatestSnapshot as getLatestSnapshotSupabase,
} from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";

export const maxDuration = 60;

/** Search Console quotas are generous, but there is no reason to hammer them. */
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Freshness of the saved search history: when it was last captured and how many days exist. */
export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  const latest = supabase && userId
    ? await getLatestSnapshotSupabase(supabase, userId, projectId)
    : getLatestSnapshot(getDb(), projectId);
  if (!latest) return NextResponse.json({ snapshot: null });

  const days = supabase && userId ? await countSnapshotsSupabase(supabase, userId, projectId) : countSnapshots(getDb(), projectId);
  return NextResponse.json({ snapshot: { capturedAt: latest.capturedAt, snapshotDate: latest.snapshotDate, days } });
}

/** Capture a fresh snapshot now (also what the daily cron does for every project). */
export async function POST() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  try {
    const latest = supabase && userId
      ? await getLatestSnapshotSupabase(supabase, userId, projectId)
      : getLatestSnapshot(getDb(), projectId);
    if (latest && Date.now() - new Date(latest.capturedAt).getTime() < MIN_REFRESH_INTERVAL_MS) {
      return NextResponse.json({ error: "Search data was refreshed a moment ago. Try again in a few minutes." }, { status: 429 });
    }

    const payload = supabase && userId
      ? await captureProjectSnapshotPlatform(supabase, userId, projectId)
      : await captureProjectSnapshotSelfHost(projectId);
    // Same daily step the cron runs after a snapshot (self-host has no cron). Isolated: never fails the refresh.
    // It only proposes inside Marlo, and does nothing unless the project opted in.
    if (supabase && userId) await runPlatformDailyProposals(supabase, userId, projectId);
    else await runSelfHostDailyProposals(projectId);
    return NextResponse.json({ snapshot: { capturedAt: payload.capturedAt, queries: payload.windows.d28.queries.length } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
