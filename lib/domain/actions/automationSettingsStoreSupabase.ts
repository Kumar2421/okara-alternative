import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTOMATION_DOC, DEFAULT_AUTOMATION, normalizeAutomation, type AutomationSettings } from "./automationSettings.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getAutomationSettings(db: SupabaseClient, userId: string, projectId: string): Promise<AutomationSettings> {
  const { data } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", AUTOMATION_DOC)
    .maybeSingle();
  if (!data?.content) return { ...DEFAULT_AUTOMATION };
  try {
    return normalizeAutomation(JSON.parse(data.content as string));
  } catch {
    return { ...DEFAULT_AUTOMATION };
  }
}

export async function saveAutomationSettings(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  settings: AutomationSettings,
  now = new Date(),
): Promise<AutomationSettings> {
  const stamp = now.toISOString();
  const saved: AutomationSettings = { mode: settings.mode, updatedAt: stamp };
  const { data: existing } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", AUTOMATION_DOC)
    .maybeSingle();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: AUTOMATION_DOC,
      status: "ready",
      content: JSON.stringify(saved),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
  return saved;
}
