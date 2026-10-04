import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildOpportunities } from "@/lib/domain/search/searchOpportunities";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";

/**
 * Grouped, explained search opportunities computed from the latest saved
 * snapshot (no Google call). `snapshot: null` means nothing has been saved yet.
 */
export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  const latest = supabase && userId
    ? await getLatestSnapshotSupabase(supabase, userId, projectId)
    : getLatestSnapshot(getDb(), projectId);
  if (!latest) return NextResponse.json({ snapshot: null });

  return NextResponse.json({
    snapshot: { capturedAt: latest.capturedAt, snapshotDate: latest.snapshotDate },
    opportunities: buildOpportunities(latest.payload),
  });
}
