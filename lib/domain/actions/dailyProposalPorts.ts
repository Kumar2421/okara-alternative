import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { createAction, listProjectActions, transitionAction } from "@/lib/domain/actions/actionStore";
import {
  createAction as createActionSupabase,
  listProjectActions as listProjectActionsSupabase,
  transitionAction as transitionActionSupabase,
} from "@/lib/domain/actions/actionStoreSupabase";
import { getAutomationSettings } from "@/lib/domain/actions/automationSettingsStore";
import { getAutomationSettings as getAutomationSettingsSupabase } from "@/lib/domain/actions/automationSettingsStoreSupabase";
import { runDailyProposals, type DailyProposalPorts, type DailyProposalSummary } from "@/lib/domain/actions/dailyProposals";
import { upsertFinding } from "@/lib/domain/findings/findingStore";
import { upsertFinding as upsertFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { sqliteFindingRepository, supabaseFindingRepository } from "@/lib/domain/findings/findingRepositories";
import { getLatestSnapshot } from "@/lib/domain/search/searchSnapshotStore";
import { getLatestSnapshot as getLatestSnapshotSupabase } from "@/lib/domain/search/searchSnapshotStoreSupabase";

/** Platform (Supabase) ports, scoped to one user's project. */
export function platformProposalPorts(db: SupabaseClient, userId: string, projectId: string): DailyProposalPorts {
  const findings = supabaseFindingRepository(db, userId);
  return {
    getMode: async () => (await getAutomationSettingsSupabase(db, userId, projectId)).mode,
    getSnapshot: () => getLatestSnapshotSupabase(db, userId, projectId),
    listFindings: async () => findings.list(projectId),
    listActions: () => listProjectActionsSupabase(db, userId, projectId),
    saveFinding: (input) => upsertFindingSupabase(db, userId, input),
    createAction: (input) => createActionSupabase(db, userId, input),
    approveAction: (id) => transitionActionSupabase(db, userId, projectId, id, "approved"),
  };
}

/** Self-host (SQLite) ports. */
export function selfHostProposalPorts(projectId: string): DailyProposalPorts {
  const findings = sqliteFindingRepository();
  return {
    getMode: async () => getAutomationSettings(getDb(), projectId).mode,
    getSnapshot: async () => getLatestSnapshot(getDb(), projectId),
    listFindings: async () => findings.list(projectId),
    listActions: async () => listProjectActions(projectId),
    saveFinding: async (input) => upsertFinding(input),
    createAction: async (input) => createAction(input),
    approveAction: async (id) => transitionAction(projectId, id, "approved"),
  };
}

type ProjectBits = { name: string | null; url: string | null };

/** Run the daily job for one platform project. Never throws: a failure is returned as a message so one project cannot stop the rest. */
export async function runPlatformDailyProposals(db: SupabaseClient, userId: string, projectId: string): Promise<DailyProposalSummary | { error: string }> {
  try {
    const { data } = await db.from("projects").select("name, url").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!data) return { error: "Project not found." };
    return await runDailyProposals(platformProposalPorts(db, userId, projectId), { id: projectId, ...(data as ProjectBits) });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Daily proposals failed." };
  }
}

/** Run the daily job for one self-host project. Never throws. */
export async function runSelfHostDailyProposals(projectId: string): Promise<DailyProposalSummary | { error: string }> {
  try {
    const project = getDb().prepare("SELECT name, url FROM projects WHERE id = ?").get(projectId) as ProjectBits | undefined;
    if (!project) return { error: "Project not found." };
    return await runDailyProposals(selfHostProposalPorts(projectId), { id: projectId, ...project });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Daily proposals failed." };
  }
}
