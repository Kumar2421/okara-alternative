import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProfile, type LeadProfile } from "./leadProfile.ts";
import { LEAD_PROFILE_DOC } from "./leadProfileStore.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getLeadProfile(db: SupabaseClient, userId: string, projectId: string): Promise<LeadProfile | null> {
  const { data } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", LEAD_PROFILE_DOC)
    .maybeSingle();
  if (!data?.content) return null;
  try {
    return normalizeProfile(JSON.parse(data.content as string));
  } catch {
    return null;
  }
}

export async function saveLeadProfile(db: SupabaseClient, userId: string, projectId: string, profile: LeadProfile, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const { data: existing } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", LEAD_PROFILE_DOC)
    .maybeSingle();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: LEAD_PROFILE_DOC,
      status: "ready",
      content: JSON.stringify(profile),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}
